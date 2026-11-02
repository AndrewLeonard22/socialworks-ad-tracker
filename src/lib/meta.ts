/* SERVER ONLY: the live Meta (Marketing API) connection. Imported by the
   /api/meta route handlers and nothing else; never import it from a page or
   component, the token and app secret must stay on the server (the node:
   imports below also keep it out of browser bundles).

   It pulls spend and leads (cost per lead is spend / leads) for every ad account
   the token can see, plus ad statuses, creative thumbnails and ad previews.

   Env, all server-only (never NEXT_PUBLIC_):
     META_ACCESS_TOKEN  system user token with ads_read
     META_APP_SECRET    when set, every call is signed with appsecret_proof
     META_API_VERSION   optional, default v26.0
     META_FIXTURE       local testing without Meta, see fixture() below */

import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountDetails, AdPreview, MetaAccount, MetaCampaign, MetaNode, Overview } from "./live";

const VERSION = "v26.0";
const MIN = 60000;
const TIMEOUT = 20000;
/** ad accounts read at once */
const CONCURRENCY = 10;
/** the whole overview answers within this, so the route never times out (maxDuration is 60s) */
const OVERVIEW_DEADLINE = 45000;
/** after a rate limit, Meta says to stop calling for a while; failed reads stay cached this long */
const COOL_DOWN = 3 * MIN;
/** creative thumbnails are requested at this size: a 38px box stays sharp on 2x+ screens */
const THUMB = 152;

/* ---------- config ---------- */

/* forgiving about how it was pasted: surrounding quotes or a "Bearer " prefix are dropped */
const token = () =>
  (process.env.META_ACCESS_TOKEN ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim();

const version = () => {
  const v = process.env.META_API_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : VERSION;
};

/** Meta's appsecret_proof: hex HMAC-SHA256 of the access token, keyed by the app secret */
export const appsecretProof = (accessToken: string, secret: string) =>
  createHmac("sha256", secret).update(accessToken).digest("hex");

/* Local testing without Meta. META_FIXTURE=1 answers every Graph call from
   src/lib/__fixtures__ (files shaped exactly like Graph responses);
   META_FIXTURE=error answers every call with Meta's "access token rejected"
   error. Only those two values turn it on, and never in a production build. */
const fixture = (): "" | "1" | "error" => {
  if (process.env.NODE_ENV === "production") return "";
  const v = process.env.META_FIXTURE;
  return v === "1" || v === "error" ? v : "";
};

/** a token is set (or fixtures stand in for Meta) */
export const metaConfigured = () => !!fixture() || !!token();

/* ---------- errors ---------- */

class MetaError extends Error {
  code: number;
  subcode: number;
  constructor(message: string, code = 0, subcode = 0) {
    super(message);
    this.code = code;
    this.subcode = subcode;
  }
}

/** token invalid, expired or revoked: nothing will work until it is replaced */
const TOKEN_CODES = new Set([102, 190]);
/** rate limits (account, app, insights and ads management throttles) */
const RATE_CODES = new Set([4, 17, 341, 613, 80000, 80004]);
/** Meta's "unknown" / "temporarily unavailable" errors: worth one retry after a pause.
    Rate limits are NOT retried: Meta says more calls extend the block (see COOL_DOWN). */
const RETRY_CODES = new Set([1, 2]);

const TOKEN_MESSAGE =
  "Meta rejected the access token. Create a new system user token and update META_ACCESS_TOKEN in Vercel.";

/** the token message plus Meta's own reason (expired, can't parse, password changed...),
    with anything token-shaped masked so the token itself is never shown */
const tokenMessage = (e: MetaError) => {
  const why = e.message.replace(/EA[A-Za-z0-9]{10,}/g, "[token]").replace(/\s+/g, " ").trim();
  return why ? `${TOKEN_MESSAGE} Meta says: "${why.length > 180 ? `${why.slice(0, 177)}...` : why}"` : TOKEN_MESSAGE;
};

/** a short, plain explanation of a failed Meta call */
export function explain(e: unknown): string {
  if (!(e instanceof MetaError)) return "Something went wrong reading Meta";
  if (TOKEN_CODES.has(e.code)) return tokenMessage(e);
  if (e.code === 200 || e.code === 10) return "No access to this ad account in Meta";
  if (RATE_CODES.has(e.code)) return "Meta rate limit reached, try again in a few minutes";
  if (e.code === 1 || e.code === 2) return "Meta is temporarily unavailable, try again shortly";
  if (e.code === 100 && e.subcode === 1487534) return "Too much data for this range, try a shorter one";
  return e.message.length > 160 ? `${e.message.slice(0, 157)}...` : e.message;
}

/* ---------- Graph calls ---------- */

/** Graph JSON: read defensively where it is used */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Reply = { status: number; body: Json };

async function send(url: URL, form?: URLSearchParams): Promise<Reply> {
  /* NODE_ENV is fixed at build time: production builds drop this branch, so
     the fixture files are never read or shipped there */
  if (process.env.NODE_ENV !== "production") {
    if (fixture()) {
      const dir = join(process.cwd(), "src/lib/__fixtures__");
      return fromFixture(url, form, async (file) => JSON.parse(await readFile(join(dir, file), "utf8")));
    }
  }
  const res = await fetch(url, {
    method: form ? "POST" : "GET",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** one Graph call (GET, or a POST when `post` is given), signed, with one retry on temporary errors */
async function graph(path: string, params: Record<string, string> = {}, post?: Record<string, string>): Promise<Json> {
  const auth: Record<string, string> = { access_token: token() || "fixture" };
  const secret = process.env.META_APP_SECRET?.trim();
  if (secret) auth.appsecret_proof = appsecretProof(auth.access_token, secret);
  const url = new URL(`https://graph.facebook.com/${version()}${path ? `/${path}` : ""}`);
  const form = post ? new URLSearchParams({ ...post, ...auth }) : undefined;
  if (!post) url.search = new URLSearchParams({ ...params, ...auth }).toString();

  for (let attempt = 0; ; attempt++) {
    let reply: Reply;
    try {
      reply = await send(url, form);
    } catch (e) {
      const slow = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new MetaError(slow ? "Meta took too long to respond" : "Couldn't reach Meta");
    }
    const { status, body } = reply;
    const err = body?.error;
    if (status < 400 && body && !err) return body;
    const e = new MetaError(
      String(err?.message || `Meta answered HTTP ${status}`),
      Number(err?.code) || 0,
      Number(err?.error_subcode) || 0
    );
    if (attempt === 0 && (RETRY_CODES.has(e.code) || (!err && status >= 500))) {
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
      continue;
    }
    throw e;
  }
}

/** every row of a list edge, following Meta's cursor paging */
async function all(path: string, params: Record<string, string>): Promise<Json[]> {
  const rows: Json[] = [];
  let after = "";
  for (let page = 0; page < 100; page++) {
    const body = await graph(path, after ? { ...params, after } : params);
    if (Array.isArray(body.data)) rows.push(...body.data);
    after = body.paging?.next ? String(body.paging.cursors?.after ?? "") : "";
    if (!after) break;
  }
  return rows;
}

/* ---------- small in-memory cache (per server instance) ---------- */

const cache = new Map<string, { until: number; value: Promise<unknown> }>();

/** successful results are kept for `ttl`; failures are forgotten so the next request retries,
    except rate limits, which stay cached for COOL_DOWN so a throttled account is left alone */
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const who = createHash("sha256").update(token()).digest("hex").slice(0, 12);
  const k = `${fixture() || who}:${key}`;
  const now = Date.now();
  const hit = cache.get(k);
  if (hit && hit.until > now) return hit.value as Promise<T>;
  if (cache.size > 500) for (const [old, v] of cache) if (v.until <= now) cache.delete(old);
  const value = load();
  cache.set(k, { until: now + ttl, value });
  value.catch((e) => {
    const cur = cache.get(k);
    if (cur?.value !== value) return;
    if (e instanceof MetaError && RATE_CODES.has(e.code)) cur.until = Date.now() + COOL_DOWN;
    else cache.delete(k);
  });
  return value;
}

/** p, or a "took too long" error after `ms` (the timer is cleared either way) */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new MetaError("Meta took too long to respond")), Math.max(0, ms));
  });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

/** run fn over items, at most `limit` at a time; fn must not throw */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/* ---------- spend and leads ---------- */

export interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  actions?: { action_type: string; value: string }[];
}

/* THE LEADS RULE, used everywhere: leads = the `lead` entry of an insights
   row's `actions`. `lead` is Meta's "Leads" metric, the Leads column in Ads
   Manager: instant-form and Messenger/Instagram leads plus website (Pixel or
   Conversions API) leads, counted with each ad set's own attribution setting.
   The narrower types Meta returns next to it (onsite_conversion.lead_grouped,
   leadgen_grouped, leadgen.other, offsite_conversion.fb_pixel_lead) are parts
   of that same total, so adding any of them would double count: they are
   ignored. `results` is not used either (it follows each campaign's objective,
   so it counts appointments for a website Schedule campaign and misses
   Messenger leads). Cost per lead = spend / leads, from totals at every level,
   never an average of per-ad cost per lead. */
export function leadsOf(actions: InsightRow["actions"]): number {
  const v = Number(actions?.find((a) => a.action_type === "lead")?.value ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

type Sum = { id: string; name: string; cents: number; leads: number; kids: Map<string, Sum> };

/** ad-level insights rows rolled up ad > ad set > campaign > account, biggest spend first */
export function rollup(rows: InsightRow[]): { spend: number; leads: number; campaigns: MetaCampaign[] } {
  const root: Sum = { id: "", name: "", cents: 0, leads: 0, kids: new Map() };
  const child = (parent: Sum, id = "", name = "") => {
    let n = parent.kids.get(id);
    if (!n) parent.kids.set(id, (n = { id, name: name || id, cents: 0, leads: 0, kids: new Map() }));
    return n;
  };
  for (const r of rows) {
    /* spend is a decimal string in the account currency; add it up in cents */
    const cents = Math.round(Number(r.spend ?? 0) * 100) || 0;
    const leads = leadsOf(r.actions);
    const c = child(root, r.campaign_id, r.campaign_name);
    const s = child(c, r.adset_id, r.adset_name);
    const ad = child(s, r.ad_id, r.ad_name);
    for (const n of [root, c, s, ad]) {
      n.cents += cents;
      n.leads += leads;
    }
  }
  const kids = (n: Sum) =>
    [...n.kids.values()].sort((a, b) => b.cents - a.cents || b.leads - a.leads || a.name.localeCompare(b.name));
  const node = (n: Sum): MetaNode => ({ id: n.id, name: n.name, spend: n.cents / 100, leads: n.leads });
  return {
    spend: root.cents / 100,
    leads: root.leads,
    campaigns: kids(root).map((c) => ({
      ...node(c),
      adsets: kids(c).map((s) => ({ ...node(s), ads: kids(s).map(node) })),
    })),
  };
}

/* by default Meta leaves archived and deleted ads out of level=ad rows, though
   Ads Manager's account total still counts what they spent, so ask for every status */
const AD_STATUSES = [
  "ACTIVE", "PAUSED", "DELETED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED",
  "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ARCHIVED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES",
];

/** set once Meta refuses the status filter, so later calls skip straight to the plain query */
let plainInsights = false;

/** one ad-level insights call per account: one row per ad that delivered in [from, to] */
function adRows(accountId: string, from: string, to: string): Promise<InsightRow[]> {
  return cached(`insights:${accountId}:${from}:${to}`, 10 * MIN, async () => {
    const params = {
      level: "ad",
      fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions",
      time_range: JSON.stringify({ since: from, until: to }),
      limit: "500",
    };
    if (plainInsights) return all(`${accountId}/insights`, params);
    const filtering = JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: AD_STATUSES }]);
    try {
      return await all(`${accountId}/insights`, { ...params, filtering });
    } catch (e) {
      /* if Meta ever refuses the status filter, use its default (no archived or deleted ads) */
      if (e instanceof MetaError && e.code === 100 && e.subcode !== 1487534) {
        if (!plainInsights) console.warn("[meta] status filter refused, reading insights without it:", e.message);
        plainInsights = true;
        return all(`${accountId}/insights`, params);
      }
      throw e;
    }
  });
}

const adAccounts = () =>
  cached("accounts", 60 * MIN, () => all("me/adaccounts", { fields: "id,name,account_status,currency", limit: "100" }));

/** every ad account the token can see, each with spend and leads for [from, to] (YYYY-MM-DD, inclusive) */
export async function getOverview(from: string, to: string): Promise<Overview> {
  if (!metaConfigured()) return { live: false, reason: "no-token" };

  let list: Json[];
  try {
    list = await adAccounts();
  } catch (e) {
    console.error("[meta] ad accounts:", e instanceof Error ? e.message : e);
    const message =
      e instanceof MetaError && TOKEN_CODES.has(e.code)
        ? tokenMessage(e)
        : `Couldn't read the ad accounts from Meta: ${e instanceof Error ? e.message : "unknown error"}`;
    return { live: false, reason: "meta-error", message };
  }

  let tokenDead: MetaError | null = null;
  const deadline = Date.now() + OVERVIEW_DEADLINE;
  const accounts = await pool(list, CONCURRENCY, async (a): Promise<MetaAccount> => {
    const base = {
      id: String(a.id),
      name: String(a.name || a.id),
      status: Number(a.account_status) || 0,
      currency: String(a.currency || ""),
    };
    try {
      /* past the deadline an account answers "took too long"; its read keeps going and
         lands in the cache, so the next load has it */
      return { ...base, ...rollup(await withDeadline(adRows(base.id, from, to), deadline - Date.now())) };
    } catch (e) {
      console.error(`[meta] insights ${base.id}:`, e instanceof Error ? e.message : e);
      if (e instanceof MetaError && TOKEN_CODES.has(e.code)) tokenDead = e;
      return { ...base, spend: 0, leads: 0, campaigns: [], error: explain(e) };
    }
  });

  const errors = accounts.filter((a) => a.error).map((a) => ({ id: a.id, message: a.error as string }));
  if (tokenDead) return { live: false, reason: "meta-error", message: tokenMessage(tokenDead) };
  if (accounts.length && errors.length === accounts.length) {
    return { live: false, reason: "meta-error", message: `Meta returned an error for every ad account: ${errors[0].message}` };
  }
  return errors.length ? { live: true, accounts, errors } : { live: true, accounts };
}

/* ---------- statuses and thumbnails for one account ---------- */

/** documented creative read at THUMB px (thumbnail_url defaults to 64px), 50 creatives per batch call */
async function sharpThumbs(creativeIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < creativeIds.length; i += 50) {
    const chunk = creativeIds.slice(i, i + 50);
    const batch = chunk.map((id) => ({
      method: "GET",
      relative_url: `${id}?fields=thumbnail_url&thumbnail_width=${THUMB}&thumbnail_height=${THUMB}`,
    }));
    const replies = await graph("", {}, { batch: JSON.stringify(batch), include_headers: "false" });
    (Array.isArray(replies) ? replies : []).forEach((r: Json, j: number) => {
      if (r?.code !== 200) return;
      try {
        const url = JSON.parse(r.body)?.thumbnail_url;
        if (url) out[chunk[j]] = String(url);
      } catch {
        /* one unreadable reply: that ad keeps its small thumbnail */
      }
    });
  }
  return out;
}

/** effective_status of every campaign, ad set and ad in act_<digits>, and each ad's thumbnail */
export function getAccountDetails(digits: string): Promise<AccountDetails> {
  const act = `act_${digits}`;
  return cached(`details:${act}`, 60 * MIN, async () => {
    const [campaigns, adsets, ads] = await Promise.all([
      all(`${act}/campaigns`, { fields: "id,effective_status", limit: "500" }),
      all(`${act}/adsets`, { fields: "id,effective_status", limit: "500" }),
      all(`${act}/ads`, { fields: "id,effective_status,creative{id,image_url,thumbnail_url}", limit: "500" }),
    ]);
    const status: Record<string, string> = {};
    for (const x of [...campaigns, ...adsets, ...ads]) {
      if (x?.id && x.effective_status) status[String(x.id)] = String(x.effective_status);
    }
    /* image ads: image_url is the original image, sharp at any size. Video, post and
       dynamic ads only have thumbnail_url, so read those creatives again at THUMB px */
    const need = [
      ...new Set(ads.filter((a) => a?.creative?.id && !a.creative.image_url).map((a) => String(a.creative.id))),
    ];
    let sharp: Record<string, string> = {};
    try {
      sharp = await sharpThumbs(need);
    } catch (e) {
      console.error(`[meta] thumbnails ${act}:`, e instanceof Error ? e.message : e);
    }
    const thumbs: Record<string, string> = {};
    for (const a of ads) {
      const c = a?.creative ?? {};
      const url = c.image_url || sharp[String(c.id)] || c.thumbnail_url;
      if (a?.id && url) thumbs[String(a.id)] = String(url);
    }
    return { status, thumbs };
  });
}

/* ---------- ad preview ---------- */

/** the iframe in Meta's preview HTML as { src, width, height }; the signed src is kept exactly */
export function previewFrame(html: string): AdPreview | null {
  const attr = (name: string) => html.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? "";
  const src = attr("src")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const ok = src.startsWith("https://") || (!!fixture() && src.startsWith("data:text/html"));
  return ok ? { src, width: Number(attr("width")) || 0, height: Number(attr("height")) || 0 } : null;
}

/** Meta's mobile feed preview of one ad. The iframe URL is signed and lasts about a day. */
export function getPreview(adId: string): Promise<AdPreview> {
  return cached(`preview:${adId}`, 60 * MIN, async () => {
    const body = await graph(`${adId}/previews`, { ad_format: "MOBILE_FEED_STANDARD" });
    const frame = previewFrame(String(body?.data?.[0]?.body ?? ""));
    if (!frame) throw new MetaError("Meta has no preview for this ad");
    return frame;
  });
}

/* ---------- fixtures (local testing only, see fixture() above) ---------- */

async function fromFixture(url: URL, form: URLSearchParams | undefined, read: (file: string) => Promise<Json>): Promise<Reply> {
  if (fixture() === "error") return { status: 400, body: await read("error.json") };

  /* batch call: each relative_url is a creative read, answered from creatives.json */
  if (form?.has("batch")) {
    const creatives = await read("creatives.json");
    const batch: { relative_url: string }[] = JSON.parse(form.get("batch") ?? "[]");
    return {
      status: 200,
      body: batch.map(({ relative_url }) => {
        const found = creatives[relative_url.split("?")[0]];
        return found
          ? { code: 200, body: JSON.stringify(found) }
          : { code: 400, body: JSON.stringify({ error: { message: "Unsupported get request.", code: 100 } }) };
      }),
    };
  }

  /* /v26.0/<id>/<edge>: <edge>.json holds Graph responses by object id (+ "|<after>" for later pages) */
  const [id, edge] = url.pathname.split("/").slice(2);
  const after = url.searchParams.get("after");
  const known = ["adaccounts", "insights", "campaigns", "adsets", "ads", "previews"];
  if (!known.includes(edge)) return { status: 400, body: { error: { message: `No fixture for ${url.pathname}`, code: 100 } } };
  const responses = await read(`${edge}.json`);
  const body = responses[after ? `${id}|${after}` : id] ?? responses.default ?? { data: [] };
  return { status: body.error ? 400 : 200, body };
}
