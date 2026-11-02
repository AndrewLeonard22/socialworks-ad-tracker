"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadAccounts, onLiveOverview } from "@/lib/live";
import type { AccountInfo } from "@/lib/live";
import { buildAccounts, todayNum } from "./data";
import type { Account, ClientStatus } from "./data";
import { ghlAccountsFrom } from "./ghl";
import type { GhlAccount } from "./ghl";

/* Business-name, GHL account, status, booking-calendar and removed edits live in this
   browser until there is a backend to save them to. Ad account names always come from Meta. */
const KEY = "sw_adtracker_v1";

type Override = { name?: string; status?: ClientStatus; ghl?: string; calendars?: string[]; removed?: boolean };

/** where the numbers come from: "dummy" without a Meta token, "live" from Meta, "error" when Meta failed */
export type Source = "loading" | "dummy" | "live" | "error";

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
  /** the GHL sub-accounts a client can be linked to */
  ghlAccounts: GhlAccount[];
  /** the GHL sub-account a client is linked to */
  ghlOf: (id: string) => GhlAccount | undefined;
  /** booking calendar ids picked for a client */
  calendarsOf: (id: string) => string[];
  setName: (id: string, name: string) => void;
  setStatus: (id: string, status: ClientStatus) => void;
  /** link a client to a GHL sub-account (null unlinks); its calendar picks start over */
  setGhl: (id: string, ghlId: string | null) => void;
  setCalendars: (id: string, ids: string[]) => void;
  setRemoved: (id: string, removed: boolean) => void;
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

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const [today, setToday] = useState<number | null>(null);
  const [over, setOver] = useState<Record<string, Override>>({});
  const [meta, setMeta] = useState<{ source: Source; error: string; list: AccountInfo[] }>({
    source: "loading",
    error: "",
    list: [],
  });

  useEffect(() => {
    let saved: Record<string, Override> = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      /* private window or blocked storage: start from the defaults */
    }
    const id = window.setTimeout(() => {
      setOver(saved);
      setToday(todayNum());
    }, 0);
    return () => window.clearTimeout(id);
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

  const base = useMemo(() => {
    if (today === null) return [];
    if (meta.source === "dummy") return buildAccounts(today);
    return meta.list.map(accountFromMeta);
  }, [today, meta]);

  /* DUMMY: one sub-account per client until GHL is connected */
  const ghlAccounts = useMemo(
    () => ghlAccountsFrom(base.map((a) => a.businessName.trim() || a.adAccountName)),
    [base]
  );
  const ghlById = useMemo(() => new Map(ghlAccounts.map((g) => [g.id, g])), [ghlAccounts]);

  const all = useMemo(
    () =>
      base.map((a) => {
        const o = over[a.id];
        if (!o) return a;
        const name = o.name !== undefined ? o.name : a.businessName;
        return {
          ...a,
          /* a typed name wins; otherwise the business name follows the linked GHL account */
          businessName: name.trim() || (o.ghl && ghlById.get(o.ghl)?.name) || name,
          status: o.status ?? a.status,
        };
      }),
    [base, over, ghlById]
  );
  /* a new ad account is on the tracker until someone removes it */
  const removedIds = useMemo(
    () => new Set(Object.keys(over).filter((id) => over[id]?.removed)),
    [over]
  );
  const accounts = useMemo(() => all.filter((a) => !removedIds.has(a.id)), [all, removedIds]);
  const removed = useMemo(() => all.filter((a) => removedIds.has(a.id)), [all, removedIds]);

  const patch = useCallback((id: string, p: Override) => {
    setOver((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...p } };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* not persisted; the edit still applies for this visit */
      }
      return next;
    });
  }, []);

  const value = useMemo<TrackerCtx>(
    () => ({
      ready: today !== null && meta.source !== "loading",
      today: today ?? 0,
      source: meta.source,
      error: meta.error,
      accounts,
      removed,
      removedIds,
      ghlAccounts,
      ghlOf: (id) => {
        const g = over[id]?.ghl;
        return g ? ghlById.get(g) : undefined;
      },
      calendarsOf: (id) => over[id]?.calendars ?? [],
      setName: (id, name) => patch(id, { name }),
      setStatus: (id, status) => patch(id, { status }),
      setGhl: (id, ghlId) => patch(id, { ghl: ghlId ?? undefined, calendars: [] }),
      setCalendars: (id, calendars) => patch(id, { calendars }),
      setRemoved: (id, r) => patch(id, { removed: r }),
    }),
    [today, meta, accounts, removed, removedIds, ghlAccounts, ghlById, over, patch]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTracker() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTracker must be used inside TrackerProvider");
  return v;
}
