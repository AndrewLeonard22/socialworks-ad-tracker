/* SERVER ONLY: the GoHighLevel connection (LeadConnector API v2). Imported by the
   /api/crm route handlers and nothing else; the client secret and tokens stay on
   the server.

   The "Ad Tracking" Marketplace app is installed once by the agency on its
   sub-accounts. The install sends GHL's code to /api/crm/callback, which trades it
   for an agency token (saved in the database, renewed before it expires: GHL hands
   out a new refresh token on every renewal and the old one stops working). Each
   sub-account is then read with its own short-lived token minted from the agency one.

   What it reads, all read-only: the sub-accounts the app is installed on, each
   one's booking calendars, and the appointments on the calendars picked for a
   client. Appointments are read as they are now (a deleted or cancelled one simply
   isn't counted), never from booking triggers.

   Env, all server-only:
     GHL_CLIENT_ID, GHL_CLIENT_SECRET   the app's client keys (Marketplace > Auth)
     GHL_APP_ID                         optional; read from the client id otherwise
     CRM_FIXTURE                        local testing without GHL, see fixture() */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Conflict, getItem, putItem } from "./db";
import type { CrmCalendar, Named } from "./live";

const API = "https://services.leadconnectorhq.com";
const MIN = 60000;
const DAY = 86400000;
const TIMEOUT = 20000;
/** sub-accounts read at once (GHL allows 100 requests per 10 seconds per sub-account) */
const CONCURRENCY = 6;
/** the appointment answer comes back within this, so the route never times out */
const DEADLINE = 45000;
const V_OAUTH = "2021-07-28";
const V_CAL = "2021-04-15";
/** where the agency token lives in the database */
const TOKEN = ["ghl", "token"] as const;
/** the Marketplace app's id, once GHL has named it (needed to list the sub-accounts) */
const APP = ["ghl", "app"] as const;
let learnedApp = "";

/* ---------- config ---------- */

const clean = (v?: string) => (v ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
const clientId = () => clean(process.env.GHL_CLIENT_ID);
const clientSecret = () => clean(process.env.GHL_CLIENT_SECRET);

/* Local testing without GHL: CRM_FIXTURE=1 answers every GHL call from
   src/lib/__fixtures__/crm.json, with appointment dates placed relative to today.
   Never in a production build. */
const fixture = () => process.env.NODE_ENV !== "production" && process.env.CRM_FIXTURE === "1";

export const crmConfigured = () => fixture() || (!!clientId() && !!clientSecret());

/* ---------- errors ---------- */

export type CrmCode = "not-connected" | "reinstall" | "config" | "rate" | "access" | "ghl";

export class CrmError extends Error {
  code: CrmCode;
  status: number;
  constructor(message: string, code: CrmCode, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const NOT_CONNECTED = "GHL isn't connected yet. Install the Ad Tracking app on your sub-accounts from the GHL Marketplace.";
const REINSTALL = "GHL access expired or was removed. Install the Ad Tracking app again from the GHL Marketplace.";

/** a short, plain explanation of a failed GHL call */
export function explain(e: unknown): string {
  if (e instanceof CrmError) return e.message;
  if (e instanceof Error && /timeout|aborted/i.test(e.name + e.message)) return "GoHighLevel took too long to answer, try again";
  return "Something went wrong reading GoHighLevel";
}

/* ---------- GHL calls ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface Call {
  method?: "GET" | "POST";
  token?: string;
  version: string;
  query?: Record<string, string>;
  form?: Record<string, string>;
}

function toError(status: number, body: Json): CrmError {
  const raw = body?.message ?? body?.error_description ?? body?.error ?? "";
  const why = (Array.isArray(raw) ? raw.join(", ") : String(raw)).replace(/\s+/g, " ").trim();
  if (status === 429) return new CrmError("GHL rate limit reached, try again in a minute", "rate", status);
  if (status === 401) return new CrmError(why || "GHL rejected the token", "access", status);
  if (status === 403) return new CrmError(why || "No access to this in GHL", "access", status);
  return new CrmError(why ? (why.length > 160 ? `${why.slice(0, 157)}...` : why) : `GHL answered ${status}`, "ghl", status);
}

async function call(path: string, c: Call): Promise<Json> {
  /* NODE_ENV is fixed at build time: production builds drop this branch */
  if (process.env.NODE_ENV !== "production" && fixture()) return fromFixture(path, c);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(c.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json", Version: c.version };
  if (c.token) headers.Authorization = `Bearer ${c.token}`;
  if (c.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await fetch(url, {
    method: c.method ?? "GET",
    headers,
    body: c.form ? new URLSearchParams(c.form) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw toError(res.status, body);
  return body;
}

/* ---------- in-memory cache (per server instance) ---------- */

const cache = new Map<string, { exp: number; p: Promise<unknown> }>();
function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p as Promise<T>;
  const p = fn();
  cache.set(key, { exp: Date.now() + ttl, p });
  p.catch(() => cache.get(key)?.p === p && cache.delete(key));
  return p;
}

/* ---------- the agency token ---------- */

interface TokenRec {
  access: string;
  refresh: string;
  /** ms epoch */
  expiresAt: number;
  /** Company: installed by the agency (bulk); Location: installed on a single sub-account */
  userType: "Company" | "Location";
  companyId?: string;
  locationId?: string;
  /** sub-accounts approved at install, when GHL says */
  approved?: string[];
  installedAt: string;
}

let memo: { rec: TokenRec; v: number } | null = null;
let renewing: Promise<{ rec: TokenRec; v: number }> | null = null;

const fresh = (rec: TokenRec, margin = 5 * MIN) => rec.expiresAt - Date.now() > margin;

const recFrom = (r: Json, prev?: TokenRec): TokenRec => ({
  access: String(r.access_token ?? ""),
  refresh: String(r.refresh_token ?? prev?.refresh ?? ""),
  expiresAt: Date.now() + (Number(r.expires_in) || 86399) * 1000,
  userType: (r.userType ?? prev?.userType) === "Location" ? "Location" : "Company",
  companyId: r.companyId ?? prev?.companyId,
  locationId: r.locationId ?? prev?.locationId,
  approved: Array.isArray(r.approvedLocations) ? r.approvedLocations.map(String) : prev?.approved,
  installedAt: prev?.installedAt ?? new Date().toISOString(),
});

/** trade the install's code for the agency token and save it (a new install replaces the old token) */
export async function connect(code: string, redirectUri: string) {
  if (!clientId() || !clientSecret()) {
    throw new CrmError("GHL_CLIENT_ID and GHL_CLIENT_SECRET aren't set in Vercel", "config");
  }
  const form = (userType: string) => ({
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "authorization_code",
    code,
    user_type: userType,
    redirect_uri: redirectUri,
  });
  let r: Json;
  try {
    r = await call("/oauth/token", { method: "POST", version: V_OAUTH, form: form("Company") });
  } catch (e) {
    /* installed on one sub-account only: GHL answers to Location instead */
    if (!(e instanceof CrmError) || (e.status !== 400 && e.status !== 422)) throw e;
    r = await call("/oauth/token", { method: "POST", version: V_OAUTH, form: form("Location") });
  }
  const rec = recFrom(r);
  if (!rec.access || !rec.refresh) throw new CrmError("GHL didn't send a token, install the app again", "ghl");
  const v = await putItem(...TOKEN, rec);
  memo = { rec, v };
  locTokens.clear();
  cache.clear();
  return { userType: rec.userType, approved: rec.approved?.length ?? (rec.locationId ? 1 : 0) };
}

async function agency(): Promise<{ rec: TokenRec; v: number }> {
  if (memo && fresh(memo.rec)) return memo;
  const item = await getItem<TokenRec>(...TOKEN);
  if (!item) throw new CrmError(NOT_CONNECTED, "not-connected");
  memo = { rec: item.data, v: item.v };
  return fresh(item.data) ? memo : renew(memo);
}

/* One renewal at a time in this instance. GHL's refresh tokens work once, so if
   another instance renewed first, ours is refused and theirs is in the database. */
function renew(from: { rec: TokenRec; v: number }) {
  renewing ??= (async () => {
    try {
      const r = await call("/oauth/token", {
        method: "POST",
        version: V_OAUTH,
        form: {
          client_id: clientId(),
          client_secret: clientSecret(),
          grant_type: "refresh_token",
          refresh_token: from.rec.refresh,
          user_type: from.rec.userType,
        },
      });
      const rec = recFrom(r, from.rec);
      let v: number;
      try {
        v = await putItem(...TOKEN, rec, from.v);
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        /* our renewal succeeded, so ours is the token that works now */
        v = await putItem(...TOKEN, rec);
      }
      memo = { rec, v };
      return memo;
    } catch (e) {
      /* refused: if another instance renewed at the same moment, its token lands in
         the database within a moment; wait for it before calling the access gone */
      for (let i = 0; i < 5; i++) {
        const now = await getItem<TokenRec>(...TOKEN);
        if (now && now.v !== from.v && fresh(now.data, MIN)) return (memo = { rec: now.data, v: now.v });
        if (!(e instanceof CrmError) || (e.status !== 400 && e.status !== 401)) break;
        await new Promise((r) => setTimeout(r, 600));
      }
      if (e instanceof CrmError && (e.status === 400 || e.status === 401 || e.code === "access")) {
        throw new CrmError(REINSTALL, "reinstall", e.status);
      }
      throw e;
    }
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

/** run a call with the agency token; a token GHL rejects early is renewed once */
async function withAgency<T>(fn: (rec: TokenRec) => Promise<T>): Promise<T> {
  const a = await agency();
  try {
    return await fn(a.rec);
  } catch (e) {
    if (!(e instanceof CrmError) || e.status !== 401) throw e;
    memo = null;
    return fn((await renew(a)).rec);
  }
}

/* ---------- sub-account tokens ---------- */

const locTokens = new Map<string, { token: string; exp: number }>();

async function locationToken(locationId: string, retry = true): Promise<string> {
  const { rec } = await agency();
  if (rec.userType === "Location") {
    if (rec.locationId !== locationId) {
      throw new CrmError("The Ad Tracking app isn't installed on this sub-account", "access", 403);
    }
    return rec.access;
  }
  const hit = locTokens.get(locationId);
  if (hit && hit.exp - Date.now() > 5 * MIN) return hit.token;
  try {
    const r = await withAgency((a) =>
      call("/oauth/locationToken", {
        method: "POST",
        token: a.access,
        version: V_OAUTH,
        form: { companyId: String(a.companyId ?? ""), locationId },
      })
    );
    if (r?.appId && !learnedApp) {
      learnedApp = String(r.appId);
      /* kept apart from the token, so this write can never put back an old refresh token */
      putItem(...APP, { appId: learnedApp }).catch(() => {});
    }
    const token = String(r?.access_token ?? "");
    if (!token) throw new CrmError("GHL didn't send a sub-account token", "ghl");
    locTokens.set(locationId, { token, exp: Date.now() + (Number(r.expires_in) || 86399) * 1000 });
    return token;
  } catch (e) {
    if (e instanceof CrmError && (e.status === 400 || e.status === 403 || e.status === 422)) {
      throw new CrmError("The Ad Tracking app isn't installed on this sub-account in GHL", "access", e.status);
    }
    if (retry && e instanceof CrmError && e.status === 401) {
      locTokens.delete(locationId);
      return locationToken(locationId, false);
    }
    throw e;
  }
}

/** a sub-account call; a sub-account token GHL rejects early is minted again once */
async function withLocation<T>(locationId: string, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await locationToken(locationId));
  } catch (e) {
    if (!(e instanceof CrmError) || e.status !== 401) throw e;
    locTokens.delete(locationId);
    return fn(await locationToken(locationId, false));
  }
}

/* ---------- what the pages read ---------- */

/** the sub-accounts the app is installed on, A to Z */
export function listAccounts(): Promise<Named[]> {
  return cached("accounts", 5 * MIN, async () => {
    const { rec } = await agency();
    if (rec.userType === "Location") {
      const loc = await location(String(rec.locationId));
      return [{ id: String(rec.locationId), name: loc.name }];
    }
    const appId = async () => {
      const set = clean(process.env.GHL_APP_ID);
      if (set) return set;
      if (learnedApp) return learnedApp;
      const saved = await getItem<{ appId?: string }>(...APP).catch(() => null);
      if (saved?.data.appId) return (learnedApp = saved.data.appId);
      /* a sub-account token's answer names the app; the client id starts with it too */
      if (rec.approved?.length) await locationToken(rec.approved[0]).catch(() => {});
      return learnedApp || clientId().split("-")[0];
    };
    const id = await appId();
    const out: Named[] = [];
    try {
      for (let skip = 0; skip < 5000; skip += 100) {
        const r = await withAgency((a) =>
          call("/oauth/installedLocations", {
            token: a.access,
            version: V_OAUTH,
            query: { companyId: String(a.companyId ?? ""), appId: id, isInstalled: "true", limit: "100", skip: String(skip) },
          })
        );
        const page: Json[] = Array.isArray(r?.locations) ? r.locations : Array.isArray(r?.items) ? r.items : [];
        for (const l of page) {
          const lid = String(l?._id ?? l?.id ?? l?.locationId ?? "");
          if (lid && l?.isInstalled !== false) out.push({ id: lid, name: String(l?.name ?? lid).trim() || lid });
        }
        if (page.length < 100 || (Number(r?.count) && out.length >= Number(r.count))) break;
      }
    } catch (e) {
      /* the list call refused (say, the app id): fall back to the sub-accounts approved at install */
      if (!(e instanceof CrmError) || e.code === "reinstall" || !rec.approved?.length) throw e;
      const named = await Promise.all(
        rec.approved.slice(0, 300).map((lid) =>
          location(lid).then((l) => ({ id: lid, name: l.name }), () => null)
        )
      );
      out.push(...named.filter((x): x is Named => !!x));
      if (!out.length) throw e;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
}

interface Loc {
  name: string;
  timezone: string;
}

/** a sub-account's name and time zone */
function location(locationId: string): Promise<Loc> {
  return cached(`loc:${locationId}`, 60 * MIN, async () => {
    const r = await withLocation(locationId, (token) =>
      call(`/locations/${encodeURIComponent(locationId)}`, { token, version: V_OAUTH })
    );
    const l = r?.location ?? r ?? {};
    return { name: String(l.name ?? locationId), timezone: validZone(l.timezone) ? l.timezone : "America/New_York" };
  });
}

const IN_PERSON = /in[\s-]?person|on[\s-]?site|in[\s-]?home|site visit|walk[\s-]?through|estimate/i;
const VIRTUAL = /zoom|google_conference|ms_teams|teams_conference|phone|call/i;

/** in person when the calendar meets at an address, or its name says so */
function inPerson(c: Json): boolean {
  const kinds: string[] = [];
  const add = (list: Json) => Array.isArray(list) && list.forEach((x) => x?.kind && kinds.push(String(x.kind)));
  add(c?.locationConfigurations);
  if (Array.isArray(c?.teamMembers)) c.teamMembers.forEach((m: Json) => add(m?.locationConfigurations));
  if (kinds.includes("address")) return true;
  if (kinds.length && kinds.every((k) => VIRTUAL.test(k))) return /in[\s-]?person|on[\s-]?site|in[\s-]?home/i.test(String(c?.name));
  return IN_PERSON.test(String(c?.name ?? ""));
}

/** a sub-account's active booking calendars */
export function listCalendars(locationId: string): Promise<CrmCalendar[]> {
  return cached(`cals:${locationId}`, 10 * MIN, async () => {
    const r = await withLocation(locationId, (token) =>
      call("/calendars/", { token, version: V_CAL, query: { locationId } })
    );
    const list: Json[] = Array.isArray(r?.calendars) ? r.calendars : [];
    return list
      .filter((c) => c?.id && c.isActive !== false)
      .map((c) => ({ id: String(c.id), name: String(c.name ?? "Calendar").trim() || "Calendar", inPerson: inPerson(c) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/* ---------- appointments ---------- */

/** a client whose appointments count: its ad account, GHL sub-account and picked calendars */
export interface Link {
  acct: string;
  location: string;
  calendars: string[];
}

const validZone = (z: unknown): z is string => {
  if (typeof z !== "string" || !z) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

/** how far a time zone is ahead of UTC at a moment, in ms */
function zoneOffset(zone: string, at: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
}

/** the moment a calendar day (YYYY-MM-DD) starts in a time zone */
export function dayStart(day: string, zone: string) {
  const guess = Date.parse(`${day}T00:00:00Z`);
  let t = guess - zoneOffset(zone, guess);
  t = guess - zoneOffset(zone, t);
  return t;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

/** FNV-1a: a short, one-way key for a booked person (the page never sees GHL contact ids) */
function key(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const time = (v: unknown) => {
  const t = typeof v === "number" ? v : Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : NaN;
};

/** cancelled and invalid appointments don't count; booked, confirmed, showed and no-shows do */
const DROP = new Set(["cancelled", "canceled", "invalid"]);

/** the people booked on one client's picked calendars, by the day they booked, within [from, to] */
async function bookedFor(link: Link, from: string, to: string): Promise<string[]> {
  const { timezone } = await location(link.location);
  const start = dayStart(from, timezone);
  const end = dayStart(nextDay(to), timezone);
  const people = new Set<string>();
  const seen = new Set<string>();
  await Promise.all(
    link.calendars.map(async (calendarId) => {
      const r = await withLocation(link.location, (token) =>
        call("/calendars/events", {
          token,
          version: V_CAL,
          query: {
            locationId: link.location,
            calendarId,
            /* booked in the range, held up to six months out (or entered up to two weeks late) */
            startTime: String(start - 14 * DAY),
            endTime: String(end + 183 * DAY),
          },
        })
      );
      const events: Json[] = Array.isArray(r?.events) ? r.events : [];
      for (const e of events) {
        const id = String(e?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (e.deleted === true) continue;
        if (e.calendarId && String(e.calendarId) !== calendarId) continue;
        if (DROP.has(String(e.appointmentStatus ?? e.status ?? "").toLowerCase())) continue;
        const added = time(e.dateAdded ?? e.createdAt);
        if (!(added >= start && added < end)) continue;
        people.add(key(`${link.location}:${e.contactId || id}`));
      }
    })
  );
  return [...people];
}

const recentTtl = (to: string) =>
  to >= new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10) ? 2 * MIN : 15 * MIN;

/** per client (ad account id): one key per person booked in [from, to] on its picked calendars */
export function appointments(links: Link[], from: string, to: string) {
  const sig = links
    .map((l) => `${l.acct}>${l.location}:${[...l.calendars].sort().join(",")}`)
    .sort()
    .join(";");
  return cached(`appts:${from}|${to}|${key(sig)}:${sig.length}`, recentTtl(to), async () => {
    await agency();
    const booked: Record<string, string[]> = {};
    const errors: { id: string; message: string }[] = [];
    const queue = [...links];
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, DEADLINE)));
    const worker = async () => {
      for (let l = queue.shift(); l && !done; l = queue.shift()) {
        const link = l;
        try {
          const people = await bookedFor(link, from, to);
          if (!done) booked[link.acct] = people;
        } catch (e) {
          if (e instanceof CrmError && (e.code === "reinstall" || e.code === "not-connected" || e.code === "config")) throw e;
          if (!done) errors.push({ id: link.acct, message: explain(e) });
        }
      }
    };
    try {
      await Promise.race([Promise.all(Array.from({ length: CONCURRENCY }, worker)), deadline]);
    } finally {
      done = true;
      clearTimeout(timer);
    }
    /* a snapshot: anything still running past the deadline can't change this answer */
    const out = { booked: { ...booked }, errors: [...errors] };
    for (const l of links) {
      if (!(l.acct in out.booked) && !out.errors.some((x) => x.id === l.acct)) {
        out.errors.push({ id: l.acct, message: "GoHighLevel took too long to answer, try again" });
      }
    }
    return out;
  });
}

/* ---------- fixtures (local testing only) ---------- */

/* GHL's side of the fixture is one process-wide state (each route has its own copy of
   this module, like separate servers; GHL itself is shared) */
const fxs = globalThis as unknown as { __atFx?: { data: Json; refresh: number } };

async function fromFixture(path: string, c: Call): Promise<Json> {
  const st = (fxs.__atFx ??= { data: null, refresh: 0 });
  st.data ??= JSON.parse(await readFile(join(process.cwd(), "src/lib/__fixtures__/crm.json"), "utf8"));
  const fx = st.data;
  const q = c.query ?? {};
  if (path === "/oauth/token") {
    /* like GHL: a refresh token works once */
    if (c.form?.grant_type === "refresh_token" && c.form.refresh_token !== `fx-refresh-${st.refresh}`) {
      throw toError(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
    }
    const n = ++st.refresh;
    return {
      access_token: `fx-agency-${n}`,
      refresh_token: `fx-refresh-${n}`,
      /* CRM_FIXTURE_TTL=1 makes every call renew the token (tests the renewal path) */
      expires_in: Number(process.env.CRM_FIXTURE_TTL) || 86399,
      userType: "Company",
      companyId: "fxCompany",
      approvedLocations: fx.locations.map((l: Json) => l._id),
    };
  }
  if (path === "/oauth/locationToken") {
    if (!fx.locations.some((l: Json) => l._id === c.form?.locationId)) throw toError(400, { message: "App not installed" });
    return { access_token: `fx-loc-${c.form?.locationId}`, expires_in: 86399, appId: "fxApp" };
  }
  if (path === "/oauth/installedLocations") {
    const skip = Number(q.skip) || 0;
    return { locations: fx.locations.slice(skip, skip + (Number(q.limit) || 100)), count: fx.locations.length };
  }
  if (path.startsWith("/locations/")) {
    const l = fx.locations.find((x: Json) => x._id === decodeURIComponent(path.slice(11)));
    if (!l) throw toError(404, { message: "Location not found" });
    return { location: { id: l._id, name: l.name, timezone: l.timezone } };
  }
  if (path === "/calendars/") return { calendars: fx.calendars[q.locationId] ?? [] };
  if (path === "/calendars/events") {
    const now = Date.now();
    const lo = Number(q.startTime);
    const hi = Number(q.endTime);
    const events = (fx.events[q.calendarId] ?? []).map((e: Json, i: number) => {
      const added = now + e.days * DAY;
      return {
        id: `${q.calendarId}-ev${i}`,
        calendarId: q.calendarId,
        locationId: q.locationId,
        contactId: e.contact,
        appointmentStatus: e.status,
        deleted: !!e.deleted,
        dateAdded: new Date(added).toISOString(),
        startTime: new Date(added + (e.ahead ?? 2) * DAY).toISOString(),
      };
    });
    return { events: events.filter((e: Json) => Date.parse(e.startTime) >= lo && Date.parse(e.startTime) <= hi) };
  }
  throw toError(404, { message: `No fixture for ${path}` });
}
