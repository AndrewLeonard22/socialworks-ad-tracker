import { getAccounts } from "@/lib/meta";

/* GET /api/meta/accounts
   The ad accounts the token can see, without numbers. Fast (one cached Meta read),
   so the app decides live vs dummy and fills Clients and Calendar without waiting
   for every account's insights.
   { live: false, reason: "no-token" } | { live: false, reason: "meta-error", message }
   | { live: true, accounts: [{ id, name, status, currency }] } */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    return Response.json(await getAccounts());
  } catch (e) {
    console.error("[meta] accounts:", e);
    return Response.json({ live: false, reason: "meta-error", message: "Something went wrong reading Meta" });
  }
}
