"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { buildAccounts, todayNum } from "./data";
import type { Account, ClientStatus } from "./data";

/* Business-name and status edits live in this browser until there is a
   backend to save them to. Ad account names always come from Meta. */
const KEY = "sw_adtracker_v1";

type Override = { name?: string; status?: ClientStatus };

interface TrackerCtx {
  /** false during SSR and the first client render (dates depend on the viewer's clock) */
  ready: boolean;
  today: number;
  accounts: Account[];
  setName: (id: string, name: string) => void;
  setStatus: (id: string, status: ClientStatus) => void;
}

const Ctx = createContext<TrackerCtx | null>(null);

/** business name, or the Meta ad account name when no business name is set */
export const displayName = (a: Account) => a.businessName.trim() || a.adAccountName;

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const [today, setToday] = useState<number | null>(null);
  const [over, setOver] = useState<Record<string, Override>>({});

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

  const base = useMemo(() => (today === null ? [] : buildAccounts(today)), [today]);

  const accounts = useMemo(
    () =>
      base.map((a) => {
        const o = over[a.id];
        if (!o) return a;
        return {
          ...a,
          businessName: o.name !== undefined ? o.name : a.businessName,
          status: o.status ?? a.status,
        };
      }),
    [base, over]
  );

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
      ready: today !== null,
      today: today ?? 0,
      accounts,
      setName: (id, name) => patch(id, { name }),
      setStatus: (id, status) => patch(id, { status }),
    }),
    [today, accounts, patch]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTracker() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTracker must be used inside TrackerProvider");
  return v;
}
