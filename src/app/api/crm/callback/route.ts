import { connect, explain } from "@/lib/crm";

/* GET /api/crm/callback?code=...
   Where GHL sends the agency after installing the Ad Tracking Marketplace app (the
   app's redirect URL). Trades the code for the agency token, saves it, and goes back
   to Clients, which says whether it worked. */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: Record<string, string>) =>
    Response.redirect(new URL(`/clients?${new URLSearchParams(q)}`, url.origin), 302);
  const code = url.searchParams.get("code");
  if (!code) return back({ crm: "error", why: "GHL didn't send an install code. Open the install link again." });
  const redirect = process.env.GHL_REDIRECT_URI?.trim() || `${url.origin}/api/crm/callback`;
  try {
    const r = await connect(code, redirect);
    return back({ crm: "connected", n: String(r.approved) });
  } catch (e) {
    console.error("[crm] install:", e);
    return back({ crm: "error", why: explain(e) });
  }
}
