import { getOverview } from "@/lib/meta";

/* GET /api/meta/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
   Every Meta ad account the token can see, with spend and leads rolled up
   account > campaign > ad set > ad for that range (inclusive).
   { live: false, reason: "no-token" }               no META_ACCESS_TOKEN: the app shows dummy data
   { live: false, reason: "meta-error", message }   Meta rejected the token or every account failed
   { live: true, accounts, errors? }                errors lists accounts that failed on their own */

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
  /* only the window the date picker can produce (the last year up to today, with a
     day of slack for time zones), so random ranges can't burn the Meta quota */
  const today = Math.floor(Date.now() / DAY) * DAY;
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || a < today - 367 * DAY || b > today + DAY) {
    return Response.json(
      { error: "from and to must be YYYY-MM-DD dates within the last year, from on or before to" },
      { status: 400 }
    );
  }
  try {
    return Response.json(await getOverview(from, to));
  } catch (e) {
    console.error("[meta] overview:", e);
    return Response.json({ live: false, reason: "meta-error", message: "Something went wrong reading Meta" });
  }
}
