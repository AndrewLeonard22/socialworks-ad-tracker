import type { Totals } from "./data";
import { dateOf } from "./data";

const EMPTY = "–";

export const money = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US");

export const money2 = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const count = (n: number) => Math.round(n).toLocaleString("en-US");

export const pct = (n: number) => (n * 100).toFixed(1) + "%";

/** totals where a metric we don't have yet is left out (live rows only have spend and leads) */
export type Metrics = Partial<Totals>;

const opt = (n: number | undefined, f: (n: number) => string) => (n === undefined ? EMPTY : f(n));

/** derived metrics, safe against divide by zero; a missing metric shows "–" */
export function derived(t: Metrics) {
  const { spend, leads, appts } = t;
  return {
    spend: opt(spend, money),
    leads: opt(leads, count),
    cpl: spend !== undefined && leads ? money2(spend / leads) : EMPTY,
    appts: opt(appts, count),
    l2a: appts !== undefined && leads ? pct(appts / leads) : EMPTY,
    cpa: spend !== undefined && appts ? money2(spend / appts) : EMPTY,
    closed: opt(t.closed, count),
    revenue: opt(t.revenue, money),
  };
}

export const fmtDay = (n: number, withYear = false) =>
  dateOf(n).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });

export const fmtTime = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export const initials = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(SWP|SW|X|SocialWorks|LLC|Inc|Ads?|Meta|Main|Acct|Account|Co)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
