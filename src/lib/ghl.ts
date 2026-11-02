/* DUMMY GoHighLevel sub-accounts and calendars until the GHL connection exists.
   Each client gets a stable sub-account (named like its ad account, without the
   agency suffix) and each sub-account a stable set of booking calendars. When GHL
   is connected, replace `ghlAccountsFrom` with the agency's sub-accounts and
   `calendarsFor` with a sub-account's calendars, keeping the same shapes. */

export interface BookingCalendar {
  id: string;
  name: string;
}

/** a GHL sub-account a client can be linked to */
export interface GhlAccount {
  id: string;
  name: string;
}

/** an ad account name without the agency suffixes ("Washbroz X SocialWorks" -> "Washbroz") */
export function cleanName(n: string) {
  let s = n
    .trim()
    .replace(/\s+[x&]\s+(social\s*works|sw)\b.*$/i, "")
    .replace(/^(swp|sw)\s*[|:-]\s*/i, "")
    .replace(/\s*\((swp|sw)\)\s*$/i, "")
    .replace(/\s+[-|]\s+(ads?|swp|sw|meta|main)\s*$/i, "")
    .replace(/\s+(ad\s+account|ad\s+acct|ads)\s*$/i, "")
    .trim();
  if (s === s.toLowerCase()) s = s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return s;
}

/** dummy sub-accounts: one per client name, A to Z (numeric-only names have none) */
export function ghlAccountsFrom(names: string[]): GhlAccount[] {
  const seen = new Map<string, GhlAccount>();
  for (const raw of names) {
    const name = cleanName(raw);
    const key = name.toLowerCase();
    if (!name || /^\d+$/.test(name) || seen.has(key)) continue;
    seen.set(key, { id: `ghl_${hash(key).toString(36)}`, name });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const STOP = new Set(["x", "sw", "swp", "socialworks", "social", "works", "llc", "inc", "co", "ad", "ads", "account", "acct", "the", "and", "meta", "main"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));

/** how close two business names are, 0 to 1 */
function closeness(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.length || !B.length) return 0;
  const ja = A.join("");
  const jb = B.join("");
  if (ja === jb) return 1;
  if (Math.min(ja.length, jb.length) >= 4 && (ja.includes(jb) || jb.includes(ja))) return 0.9;
  const sb = new Set(B);
  const shared = new Set(A.filter((w) => sb.has(w))).size;
  return (0.8 * shared) / Math.min(new Set(A).size, sb.size);
}

/** sub-accounts whose name is close to the client's ad account name, best first */
export function suggestedFor(name: string, accounts: GhlAccount[]): GhlAccount[] {
  return accounts
    .map((g) => ({ g, s: closeness(name, g.name) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.g);
}

/** in-person consultation calendars are the ones we suggest */
export const isInPerson = (name: string) =>
  /in[\s-]?person|on[\s-]?site|in[\s-]?home|site visit|walk[\s-]?through/i.test(name);

/* the first three are in-person */
const POOL = [
  "In-Person Consultation",
  "On-Site Estimate",
  "In-Home Design Consultation",
  "Phone Consultation",
  "Virtual Consultation",
  "Follow-Up Call",
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the booking calendars of a GHL sub-account */
export function calendarsFor(accountId: string): BookingCalendar[] {
  const r = rng(hash(accountId + "ghl"));
  /* one in-person calendar for sure, then 2 to 4 others from the rest of the pool */
  const first = Math.floor(r() * 3);
  const rest = POOL.map((_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const picks = [first, ...rest.slice(0, 2 + Math.floor(r() * 3))].sort((a, b) => a - b);
  return picks.map((i) => ({ id: `${accountId}-cal-${i}`, name: POOL[i] }));
}
