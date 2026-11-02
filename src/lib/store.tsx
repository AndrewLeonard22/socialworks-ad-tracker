"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { v2toast } from "@/components/v2/Toast";
import {
  clearAppointments,
  importSettings,
  loadAccounts,
  loadCrmAccounts,
  loadSettings,
  onLiveOverview,
  saveSettings,
} from "@/lib/live";
import type { AccountInfo, ClientSettings, Named, SettingsMap, SettingsPatch } from "@/lib/live";
import { buildAccounts, todayNum } from "./data";
import type { Account, ClientStatus } from "./data";
import { bestMatch, ghlAccountsFrom } from "./ghl";

/* What the Clients tab edits (business name, GHL account, booking calendars, status,
   removed) is saved in the tracker's database through /api/clients, so everyone sees
   the same. This browser keeps a copy for an instant first paint and for when the
   database can't be reached. Ad account names always come from Meta. */
const KEY = "sw_adtracker_v1";

/** where the numbers come from: "dummy" without a Meta token, "live" from Meta, "error" when Meta failed */
export type Source = "loading" | "dummy" | "live" | "error";

/** the GHL connection as the pages see it */
export interface Crm {
  /** dummy: made-up sub-accounts (no Meta token); on: connected; off: not connected or failing */
  state: "dummy" | "loading" | "on" | "off";
  /** why it's off, short enough for a tooltip */
  why: string;
}

interface TrackerCtx {
  /** false during SSR and the first client render (dates depend on the viewer's clock), and until the source is known */
  ready: boolean;
  today: number;
  source: Source;
  /** what went wrong, when source is "error" */
  error: string;
  /** the clients shown everywhere (removed ones left out) */
  accounts: Account[];
  /** clients taken off the tracker; they can be added back */
  removed: Account[];
  /** ad account ids of removed clients */
  removedIds: Set<string>;
  crm: Crm;
  /** the GHL sub-accounts a client can be linked to */
  ghlAccounts: Named[];
  /** the GHL sub-account a client is linked to */
  ghlOf: (id: string) => Named | undefined;
  /** booking calendars picked for a client */
  calendarsOf: (id: string) => Named[];
  setName: (id: string, name: string) => void;
  setStatus: (id: string, status: ClientStatus) => void;
  /** link a client to a GHL sub-account (null unlinks); its calendar picks start over */
  setGhl: (id: string, ghl: Named | null) => void;
  setCalendars: (id: string, calendars: Named[]) => void;
  setRemoved: (id: string, removed: boolean) => void;
  /** read the GHL sub-accounts again (after the app is installed) */
  refreshCrm: () => void;
}

const Ctx = createContext<TrackerCtx | null>(null);

/** business name (typed, or the linked GHL account's), else the Meta ad account name */
export const displayName = (a: Account) => a.businessName.trim() || a.adAccountName;

/** a Meta ad account as a client: identity only (the dummy model fields stay empty) */
export const accountFromMeta = (m: { id: string; name: string }): Account => ({
  id: m.id,
  adAccountName: m.name,
  businessName: "",
  status: "active",
  tone: [...m.id].reduce((h, c) => h + c.charCodeAt(0), 0) % 7,
  cpl: 0,
  bookRate: 0,
  closeRate: 0,
  ticket: 0,
  campaigns: [],
});

const isNamed = (v: unknown): v is Named =>
  !!v && typeof v === "object" && typeof (v as Named).id === "string" && typeof (v as Named).name === "string";

/** one client's settings with anything malformed dropped (older saves kept bare ids) */
function tidy(raw: unknown): ClientSettings {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const s: ClientSettings = {};
  if (typeof o.name === "string") s.name = o.name;
  if (o.status === "active" || o.status === "paused" || o.status === "churned") s.status = o.status;
  if (isNamed(o.ghl)) s.ghl = { id: o.ghl.id, name: o.ghl.name };
  if (Array.isArray(o.calendars)) s.calendars = o.calendars.filter(isNamed).map((c) => ({ id: c.id, name: c.name }));
  if (typeof o.unlinked === "boolean") s.unlinked = o.unlinked;
  if (typeof o.removed === "boolean") s.removed = o.removed;
  return s;
}

const tidyAll = (raw: unknown): SettingsMap =>
  raw && typeof raw === "object"
    ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([id, s]) => [id, tidy(s)]))
    : {};

function readLocal(): SettingsMap {
  try {
    return tidyAll(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    /* private window or blocked storage: start from the defaults */
    return {};
  }
}

function writeLocal(s: SettingsMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not kept in this browser; the database still has it */
  }
}

function applyPatch(cur: ClientSettings, patch: SettingsPatch): ClientSettings {
  const next: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  return next as ClientSettings;
}

/** a short reason for the GHL picker's tooltip */
function crmWhy(reason: string) {
  if (reason === "not-connected") return "Connect GHL first: install the Ad Tracking app on your sub-accounts";
  if (reason === "reinstall") return "GHL access expired: install the Ad Tracking app again";
  if (reason === "config") return "GHL keys are missing in Vercel";
  return "GoHighLevel didn't answer, try again shortly";
}

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const [today, setToday] = useState<number | null>(null);
  const [over, setOver] = useState<SettingsMap>({});
  const [meta, setMeta] = useState<{ source: Source; error: string; list: AccountInfo[] }>({
    source: "loading",
    error: "",
    list: [],
  });
  const [crmList, setCrmList] = useState<{ state: Crm["state"]; why: string; list: Named[] }>({
    state: "loading",
    why: "",
    list: [],
  });
  const [crmTick, setCrmTick] = useState(0);
  /** the database's settings are in (only then may links be filled in automatically) */
  const [synced, setSynced] = useState(false);

  /* this browser's copy first (instant), then the database's, which wins. The first
     visit after the move copies this browser's old edits up (names, statuses, removed). */
  useEffect(() => {
    const local = readLocal();
    const id = window.setTimeout(() => {
      setOver(local);
      setToday(todayNum());
    }, 0);
    let on = true;
    const use = (s: SettingsMap) => {
      if (!on) return;
      const t = tidyAll(s);
      setOver(t);
      writeLocal(t);
      setSynced(true);
    };
    loadSettings()
      .then((r) => {
        if (!r.ok) return;
        const old = Object.fromEntries(
          Object.entries(local)
            .map(([cid, s]) => [cid, { name: s.name, status: s.status, removed: s.removed }] as const)
            .filter(([, s]) => s.name !== undefined || s.status !== undefined || s.removed !== undefined)
        );
        if (!Object.keys(r.settings).length && Object.keys(old).length) {
          return importSettings(old).then((r2) => r2.ok && use(r2.settings));
        }
        use(r.settings);
      })
      .catch(() => {
        /* no database (the shareable page, or it's down): this browser's copy stands */
      });
    return () => {
      on = false;
      window.clearTimeout(id);
    };
  }, []);

  /* one light request (ad accounts only, no numbers) decides where the numbers come
     from: without a Meta token the app keeps its dummy data, otherwise the clients
     are the token's ad accounts. The dashboard loads the numbers on its own. */
  useEffect(() => {
    if (today === null) return;
    let on = true;
    loadAccounts().then((a) => {
      if (!on) return;
      if (a.live) setMeta({ source: "live", error: "", list: a.accounts });
      else if (a.reason === "no-token") setMeta({ source: "dummy", error: "", list: [] });
      else setMeta({ source: "error", error: a.message, list: [] });
    });
    return () => {
      on = false;
    };
  }, [today]);

  /* any later live answer (say, the dashboard's next range) revives a failed first
     load and keeps the client list current */
  useEffect(
    () =>
      onLiveOverview((o) =>
        setMeta((m) =>
          m.source === "live" && m.list.length === o.accounts.length && m.list.every((a, i) => a.id === o.accounts[i].id)
            ? m
            : { source: "live", error: "", list: o.accounts }
        )
      ),
    []
  );

  /* the GHL sub-accounts, once the clients are live Meta ad accounts */
  useEffect(() => {
    if (meta.source === "loading") return;
    if (meta.source === "dummy") {
      setCrmList({ state: "dummy", why: "", list: [] });
      return;
    }
    let on = true;
    loadCrmAccounts(crmTick > 0).then((r) => {
      if (!on) return;
      setCrmList(r.ok ? { state: "on", why: "", list: r.accounts } : { state: "off", why: crmWhy(r.reason), list: [] });
    });
    return () => {
      on = false;
    };
  }, [meta.source, crmTick]);

  const base = useMemo(() => {
    if (today === null) return [];
    if (meta.source === "dummy") return buildAccounts(today);
    return meta.list.map(accountFromMeta);
  }, [today, meta]);

  /* DUMMY mode: one made-up sub-account per client; live: the installed sub-accounts */
  const ghlAccounts = useMemo(
    () =>
      crmList.state === "dummy"
        ? ghlAccountsFrom(base.map((a) => a.businessName.trim() || a.adAccountName))
        : crmList.list,
    [crmList, base]
  );
  const ghlById = useMemo(() => new Map(ghlAccounts.map((g) => [g.id, g])), [ghlAccounts]);
  /* the linked sub-account, with its current GHL name when GHL answered */
  const ghlOf = useCallback(
    (id: string) => {
      const g = over[id]?.ghl;
      return g ? (ghlById.get(g.id) ?? g) : undefined;
    },
    [over, ghlById]
  );

  const all = useMemo(
    () =>
      base.map((a) => {
        const o = over[a.id];
        if (!o) return a;
        const name = o.name !== undefined ? o.name : a.businessName;
        return {
          ...a,
          /* a typed name wins; otherwise the business name follows the linked GHL account */
          businessName: name.trim() || ghlOf(a.id)?.name || name,
          status: o.status ?? a.status,
        };
      }),
    [base, over, ghlOf]
  );
  /* a new ad account is on the tracker until someone removes it */
  const removedIds = useMemo(
    () => new Set(Object.keys(over).filter((id) => over[id]?.removed)),
    [over]
  );
  const accounts = useMemo(() => all.filter((a) => !removedIds.has(a.id)), [all, removedIds]);
  const removed = useMemo(() => all.filter((a) => removedIds.has(a.id)), [all, removedIds]);

  /* the change shows at once and is saved in the background; if the save fails it
     stays in this browser and a toast says so */
  const patch = useCallback((id: string, p: SettingsPatch) => {
    setOver((prev) => {
      const next = { ...prev, [id]: applyPatch(prev[id] ?? {}, p) };
      writeLocal(next);
      return next;
    });
    if (p.ghl !== undefined || p.calendars !== undefined || p.removed !== undefined) clearAppointments();
    saveSettings(id, p).catch((e: Error) =>
      v2toast(`Not saved for everyone: ${e.message}`, "x")
    );
  }, []);

  /* a client with no GHL account gets its suggested one filled in (new clients too).
     Only once the database's settings are in, so a saved link is never overwritten;
     a client someone unlinked on purpose, or took off the tracker, is left alone. */
  useEffect(() => {
    if (!synced || crmList.state !== "on" || !crmList.list.length) return;
    for (const a of base) {
      const o = over[a.id];
      if (o?.ghl || o?.unlinked || o?.removed) continue;
      const g = bestMatch(a.adAccountName, crmList.list);
      if (!g) continue;
      const ghl = { id: g.id, name: g.name };
      setOver((prev) => (prev[a.id]?.ghl ? prev : { ...prev, [a.id]: { ...prev[a.id], ghl } }));
      /* the database has the last word: if someone linked or unlinked it meanwhile, take theirs */
      saveSettings(a.id, { ghl }, true).then(
        (r) =>
          setOver((prev) => {
            const next = { ...prev, [a.id]: tidy(r.settings) };
            writeLocal(next);
            return next;
          }),
        () => {
          /* not saved: it fills in again on the next visit */
        }
      );
    }
  }, [synced, crmList, base, over]);

  const value = useMemo<TrackerCtx>(
    () => ({
      ready: today !== null && meta.source !== "loading",
      today: today ?? 0,
      source: meta.source,
      error: meta.error,
      accounts,
      removed,
      removedIds,
      crm: { state: crmList.state, why: crmList.why },
      ghlAccounts,
      ghlOf,
      calendarsOf: (id) => over[id]?.calendars ?? [],
      setName: (id, name) => patch(id, { name }),
      setStatus: (id, status) => patch(id, { status }),
      setGhl: (id, ghl) => patch(id, { ghl, calendars: null, unlinked: ghl ? null : true }),
      setCalendars: (id, calendars) => patch(id, { calendars }),
      setRemoved: (id, r) => patch(id, { removed: r }),
      refreshCrm: () => setCrmTick((t) => t + 1),
    }),
    [today, meta, accounts, removed, removedIds, crmList, ghlAccounts, ghlOf, over, patch]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTracker() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTracker must be used inside TrackerProvider");
  return v;
}
