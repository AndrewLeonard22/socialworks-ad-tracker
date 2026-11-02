/* DUMMY GoHighLevel calendars until the GHL connection exists.
   Each client gets a stable set of booking calendars generated from its ad
   account id. When GHL is connected, replace `calendarsFor` with the calendars
   of the client's sub-account and keep the same shape. */

export interface BookingCalendar {
  id: string;
  name: string;
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
