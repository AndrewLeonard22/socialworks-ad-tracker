/* DUMMY DATA. Nothing here is live.
   Every account, campaign, ad set, metric and appointment below is generated
   from a fixed seed so the numbers stay stable between reloads. The app runs
   on it when no Meta token is set; with one, spend and leads come from Meta
   (src/lib/meta.ts) and only the calendar's appointments stay dummy. When the
   CRM/calendar source (appointments, closed deals, revenue) is connected,
   replace `dailyMetrics` and `appointmentsBetween` with real fetches. */

export type ClientStatus = "active" | "paused" | "churned";

export interface AdSet {
  id: string;
  name: string;
  /** dayNum the ad set started delivering */
  start: number;
  /** dayNum the ad set was paused (undefined = still running) */
  end?: number;
  budget: number;
  cplMult: number;
}

export interface Campaign {
  id: string;
  name: string;
  adSets: AdSet[];
}

export interface Account {
  /** Meta ad account id */
  id: string;
  /** name as it appears in Meta; read-only */
  adAccountName: string;
  /** seeded business name; empty means "not set yet" (falls back to adAccountName) */
  businessName: string;
  status: ClientStatus;
  tone: number;
  cpl: number;
  bookRate: number;
  closeRate: number;
  ticket: number;
  campaigns: Campaign[];
}

export interface Totals {
  spend: number;
  leads: number;
  appts: number;
  closed: number;
  revenue: number;
}

export interface Appointment {
  id: string;
  accountId: string;
  day: number;
  /** minutes from midnight */
  min: number;
  lead: string;
  type: string;
}

/* ---------- dates as integer day numbers (timezone safe) ---------- */

export const dayNumOf = (d: Date) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

export const dateOf = (n: number) => {
  const u = new Date(n * 86400000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
};

export const todayNum = () => dayNumOf(new Date());

/** how far back the dummy history goes */
export const HISTORY_DAYS = 365;

/* ---------- seeded randomness ---------- */

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

/* ---------- accounts ---------- */

const SEEDS: [string, string, string, ClientStatus, number][] = [
  ["act_1048223915736", "Summit Outdoor Living - Ads", "Summit Outdoor Living", "active", 16000],
  ["act_2290471186204", "BlueLine Roofing (SWP)", "BlueLine Roofing", "active", 12000],
  ["act_3317709245581", "SWP | Prestige Pergolas", "", "active", 11000],
  ["act_4402918830467", "Coastal Pavers Ad Account", "Coastal Pavers & Patios", "active", 9000],
  ["act_5561037742219", "Ironwood Fence - Main", "Ironwood Fence Co.", "active", 6000],
  ["act_6634815509972", "Evergreen Landscape", "Evergreen Landscape Design", "active", 13000],
  ["act_7728340061135", "Apex Remodeling LLC", "", "active", 22000],
  ["act_8815562290348", "Lakeside Decks - SWP", "Lakeside Decks", "active", 15000],
  ["act_9902274418851", "Granite Ridge - Meta", "Granite Ridge Hardscapes", "active", 17000],
  ["act_1173390625540", "Sunset Pools Ads", "Sunset Pools & Spas", "paused", 38000],
  ["act_1286645190027", "Crown Coatings Ad Acct", "Crown Concrete Coatings", "paused", 5000],
  ["act_1391128847763", "Brightview Windows & Doors", "Brightview Windows", "churned", 8000],
];

const CAMPAIGNS = [
  "Leads | Broad | Advantage+",
  "Leads | Homeowners 35-65",
  "Leads | Retargeting 30d",
  "Leads | Lookalike 1%",
  "Leads | Video Testimonials",
  "Leads | Financing Offer",
];

const AD_SETS = [
  "Broad | 25mi radius",
  "Broad | 40mi radius",
  "Homeowners | Interests",
  "LAL 1% | Past customers",
  "Site visitors 30d",
  "Video viewers 50%",
  "Engaged IG 90d",
  "Advantage+ audience",
];

function pick<T>(list: T[], n: number, r: () => number) {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

export function buildAccounts(today: number): Account[] {
  return SEEDS.map(([id, adAccountName, businessName, status, ticket], idx) => {
    const r = rng(hash(id));
    /* when the account stopped spending, by status */
    const stopped =
      status === "churned"
        ? today - 45 - Math.floor(r() * 30)
        : status === "paused"
          ? today - 4 - Math.floor(r() * 12)
          : undefined;
    const campaigns = pick(CAMPAIGNS, 2 + Math.floor(r() * 3), r).map((name, ci) => {
      const cid = `${id.slice(4, 10)}${ci + 1}`;
      return {
        id: `cmp_${cid}`,
        name,
        adSets: pick(AD_SETS, 1 + Math.floor(r() * 3), r).map((asName, ai) => {
          const start = today - 40 - Math.floor(r() * (HISTORY_DAYS + 60));
          /* a few ad sets inside active accounts are paused on their own */
          const selfPaused = !stopped && r() < 0.22 ? today - 3 - Math.floor(r() * 60) : undefined;
          return {
            id: `as_${cid}${ai + 1}`,
            name: asName,
            start,
            end: stopped ?? selfPaused,
            budget: 22 + Math.round(r() * 110),
            cplMult: 0.72 + r() * 0.65,
          };
        }),
      };
    });
    return {
      id,
      adAccountName,
      businessName,
      status,
      tone: idx % 7,
      cpl: 24 + Math.round(r() * 44),
      bookRate: 0.24 + r() * 0.22,
      closeRate: 0.1 + r() * 0.12,
      ticket,
      campaigns,
    };
  });
}

/* ---------- metrics ---------- */

export const emptyTotals = (): Totals => ({ spend: 0, leads: 0, appts: 0, closed: 0, revenue: 0 });

export function addTotals(a: Totals, b: Totals) {
  a.spend += b.spend;
  a.leads += b.leads;
  a.appts += b.appts;
  a.closed += b.closed;
  a.revenue += b.revenue;
  return a;
}

/** one ad set, one day */
function dailyMetrics(acc: Account, set: AdSet, day: number, out: Totals) {
  if (day < set.start || (set.end !== undefined && day > set.end)) return;
  const r = rng(hash(set.id) ^ Math.imul(day, 2654435761));
  const spend = set.budget * (0.78 + r() * 0.44);
  const leads = Math.floor(spend / (acc.cpl * set.cplMult * (0.75 + r() * 0.5)) + r());
  const appts = Math.min(leads, Math.floor(leads * acc.bookRate + r()));
  const closed = Math.min(appts, Math.floor(appts * acc.closeRate + r()));
  const revenue = closed ? Math.round((closed * acc.ticket * (0.45 + r() * 0.5)) / 10) * 10 : 0;
  out.spend += spend;
  out.leads += leads;
  out.appts += appts;
  out.closed += closed;
  out.revenue += revenue;
}

export interface AdSetRow {
  set: AdSet;
  t: Totals;
}
export interface CampaignRow {
  campaign: Campaign;
  t: Totals;
  sets: AdSetRow[];
}
export interface AccountRow {
  account: Account;
  t: Totals;
  campaigns: CampaignRow[];
}

/** roll every ad set up into campaign and account totals for [from, to] */
export function rollup(accounts: Account[], from: number, to: number): AccountRow[] {
  return accounts.map((account) => {
    const t = emptyTotals();
    const campaigns = account.campaigns.map((campaign) => {
      const ct = emptyTotals();
      const sets = campaign.adSets.map((set) => {
        const st = emptyTotals();
        for (let d = from; d <= to; d++) dailyMetrics(account, set, d, st);
        addTotals(ct, st);
        return { set, t: st };
      });
      sets.sort((a, b) => b.t.spend - a.t.spend);
      addTotals(t, ct);
      return { campaign, t: ct, sets };
    });
    campaigns.sort((a, b) => b.t.spend - a.t.spend);
    return { account, t, campaigns };
  });
}

export const isRunning = (set: AdSet, today: number) =>
  set.start <= today && (set.end === undefined || set.end >= today);

/* ---------- appointments (calendar) ---------- */

const FIRST = ["Mike", "Sarah", "David", "Jen", "Chris", "Amanda", "Tom", "Laura", "Kevin", "Megan", "Brian", "Nicole", "Jason", "Rachel", "Eric", "Kim", "Matt", "Erin", "Steve", "Dana"];
const LAST = "ABCDEFGHJKLMNPRSTW";
const TYPES = ["Estimate", "Consultation", "Site visit", "Design call"];

export function appointmentsBetween(accounts: Account[], from: number, to: number, today: number): Appointment[] {
  const out: Appointment[] = [];
  for (const acc of accounts) {
    const base = rng(hash(acc.id + "appt"));
    const perDay = 0.35 + base() * 0.8;
    /* paused accounts keep what was already booked for the next week; churned keep nothing ahead */
    const last = acc.status === "churned" ? today - 50 : acc.status === "paused" ? today + 7 : Infinity;
    for (let d = from; d <= to && d <= last; d++) {
      const dow = dateOf(d).getDay();
      if (dow === 0) continue;
      const r = rng(hash(acc.id) ^ Math.imul(d, 40503));
      const n = Math.floor(perDay * (dow === 6 ? 0.4 : 1) + r());
      const used = new Set<number>();
      for (let i = 0; i < n; i++) {
        let slot = 16 + Math.floor(r() * 20); /* 8:00 to 17:30 in half hours */
        while (used.has(slot)) slot = slot >= 35 ? 16 : slot + 1;
        used.add(slot);
        out.push({
          id: `${acc.id}-${d}-${i}`,
          accountId: acc.id,
          day: d,
          min: slot * 30,
          lead: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}.`,
          type: TYPES[Math.floor(r() * TYPES.length)],
        });
      }
    }
  }
  return out.sort((a, b) => a.day - b.day || a.min - b.min);
}
