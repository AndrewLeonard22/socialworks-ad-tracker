import type { Totals } from "./data";
import { dateOf } from "./data";

const EMPTY = "–";

export const money = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US");

export const money2 = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const count = (n: number) => Math.round(n).toLocaleString("en-US");

export const pct = (n: number) => (n * 100).toFixed(1) + "%";

/** derived metrics, safe against divide by zero */
export function derived(t: Totals) {
  return {
    spend: money(t.spend),
    leads: count(t.leads),
    cpl: t.leads ? money2(t.spend / t.leads) : EMPTY,
    appts: count(t.appts),
    l2a: t.leads ? pct(t.appts / t.leads) : EMPTY,
    cpa: t.appts ? money2(t.spend / t.appts) : EMPTY,
    closed: count(t.closed),
    revenue: money(t.revenue),
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
    .filter((w) => w && !/^(SWP|LLC|Ads?|Meta|Main|Acct|Account|Co)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
