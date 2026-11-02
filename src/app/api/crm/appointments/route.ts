import { appointments, crmConfigured } from "@/lib/crm";
import type { Link } from "@/lib/crm";
import { explainDb } from "@/lib/db";
import { allSettings } from "@/lib/settings";
import { crmFail } from "../reply";

/* GET /api/crm/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
   For every client linked to a GHL sub-account with booking calendars picked, the
   people booked on those calendars over the range, by the day they booked (in the
   sub-account's time zone). Read straight from the calendars each time, so deleted
   and cancelled appointments drop out.
   { ok: true, booked: { [adAccountId]: [personKey...] }, errors? } | { ok: false, reason, message } */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86400000;

/** YYYY-MM-DD as UTC milliseconds, or NaN unless it is a real date */
function parseDay(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(s) ? t : NaN;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";
  const a = parseDay(from);
  const b = parseDay(to);
  const today = Math.floor(Date.now() / DAY) * DAY;
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || a < today - 367 * DAY || b > today + DAY) {
    return Response.json(
      { ok: false, reason: "error", message: "from and to must be YYYY-MM-DD dates within the last year" },
      { status: 400 }
    );
  }
  if (!crmConfigured()) return Response.json({ ok: true, booked: {} });
  let links: Link[];
  try {
    const all = await allSettings();
    links = Object.entries(all)
      .filter(([, s]) => !s.removed && s.ghl && s.calendars?.length)
      .map(([acct, s]) => ({ acct, location: s.ghl!.id, calendars: s.calendars!.map((c) => c.id) }));
  } catch (e) {
    console.error("[crm] appointments settings:", e);
    return Response.json({ ok: false, reason: "error", message: explainDb(e) });
  }
  if (!links.length) return Response.json({ ok: true, booked: {} });
  try {
    const r = await appointments(links, from, to);
    return Response.json({ ok: true, booked: r.booked, ...(r.errors.length ? { errors: r.errors } : {}) });
  } catch (e) {
    console.error("[crm] appointments:", e);
    return Response.json(crmFail(e));
  }
}
