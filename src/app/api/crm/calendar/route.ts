import { calendarAppointments, crmConfigured } from "@/lib/crm";
import type { CalLink } from "@/lib/crm";
import { explainDb } from "@/lib/db";
import { allSettings } from "@/lib/settings";
import { crmFail } from "../reply";

/* GET /api/crm/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
   For the Calendar tab: every appointment on each client's picked GHL calendars that
   falls on those days (local to the client's sub-account), read as the calendars stand
   now (deleted, cancelled and invalid ones left out).
   { ok: true, appointments: [{ id, acct, date, min, lead, type }], errors? } | { ok: false, reason, message } */

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
  /* what the month grid can show: up to six weeks at a time, within a year either side */
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || b - a > 62 * DAY || a < today - 400 * DAY || b > today + 400 * DAY) {
    return Response.json(
      { ok: false, reason: "error", message: "from and to must be YYYY-MM-DD dates up to six weeks apart, within a year of today" },
      { status: 400 }
    );
  }
  if (!crmConfigured()) return Response.json({ ok: true, appointments: [] });
  let links: CalLink[];
  try {
    const all = await allSettings();
    links = Object.entries(all)
      .filter(([, s]) => !s.removed && s.ghl && s.calendars?.length)
      .map(([acct, s]) => ({
        acct,
        location: s.ghl!.id,
        calendars: s.calendars!.map((c) => c.id),
        names: Object.fromEntries(s.calendars!.map((c) => [c.id, c.name])),
      }));
  } catch (e) {
    console.error("[crm] calendar settings:", e);
    return Response.json({ ok: false, reason: "error", message: explainDb(e) });
  }
  if (!links.length) return Response.json({ ok: true, appointments: [] });
  try {
    const r = await calendarAppointments(links, from, to);
    return Response.json({ ok: true, appointments: r.appointments, ...(r.errors.length ? { errors: r.errors } : {}) });
  } catch (e) {
    console.error("[crm] calendar:", e);
    return Response.json(crmFail(e));
  }
}
