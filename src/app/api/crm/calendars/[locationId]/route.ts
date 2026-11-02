import { crmConfigured, listCalendars } from "@/lib/crm";
import { crmFail } from "../../reply";

/* GET /api/crm/calendars/{locationId}
   A GHL sub-account's active booking calendars.
   { ok: true, calendars: [{ id, name, inPerson }] } | { ok: false, reason, message } */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(locationId)) {
    return Response.json({ ok: false, reason: "error", message: "Unknown sub-account" }, { status: 400 });
  }
  if (!crmConfigured()) {
    return Response.json({ ok: false, reason: "config", message: "GHL_CLIENT_ID and GHL_CLIENT_SECRET aren't set in Vercel" });
  }
  try {
    return Response.json({ ok: true, calendars: await listCalendars(locationId) });
  } catch (e) {
    console.error("[crm] calendars:", e);
    return Response.json(crmFail(e));
  }
}
