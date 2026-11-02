import { crmConfigured, listAccounts } from "@/lib/crm";
import { crmFail } from "../reply";

/* GET /api/crm/accounts
   The GHL sub-accounts the Ad Tracking app is installed on, A to Z.
   { ok: true, accounts: [{ id, name }] } | { ok: false, reason, message } */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!crmConfigured()) {
    return Response.json({ ok: false, reason: "config", message: "GHL_CLIENT_ID and GHL_CLIENT_SECRET aren't set in Vercel" });
  }
  try {
    return Response.json({ ok: true, accounts: await listAccounts() });
  } catch (e) {
    console.error("[crm] accounts:", e);
    return Response.json(crmFail(e));
  }
}
