/* Live Meta data as the pages see it: the shapes the /api/meta routes return, and
   the fetch helpers the pages share (one request per range, ad account or ad,
   reused during the visit). Safe for the browser: the Meta token never comes
   here, it stays in src/lib/meta.ts on the server. The artifact build swaps this
   module for artifact/shims/live.ts (a static page has no API routes). */

export interface MetaNode {
  id: string;
  name: string;
  spend: number;
  leads: number;
}
export interface MetaAdSet extends MetaNode {
  ads: MetaNode[];
}
export interface MetaCampaign extends MetaNode {
  adsets: MetaAdSet[];
}
export interface MetaAccount extends MetaNode {
  /** Meta account_status (1 = active) */
  status: number;
  currency: string;
  campaigns: MetaCampaign[];
  /** set when this one account could not be read: its numbers are unknown, not zero */
  error?: string;
}

/** an ad account without numbers (the roster) */
export interface AccountInfo {
  id: string;
  name: string;
  status: number;
  currency: string;
}

export type AccountList =
  | { live: false; reason: "no-token" }
  | { live: false; reason: "meta-error"; message: string }
  | { live: true; accounts: AccountInfo[] };

export type Overview =
  | { live: false; reason: "no-token" }
  | { live: false; reason: "meta-error"; message: string }
  | { live: true; accounts: MetaAccount[]; errors?: { id: string; message: string }[] };

/** effective_status by campaign, ad set and ad id; creative thumbnail URL by ad id */
export interface AccountDetails {
  status: Record<string, string>;
  thumbs: Record<string, string>;
}

/** Meta's signed preview iframe for one ad */
export interface AdPreview {
  src: string;
  width: number;
  height: number;
}

/** a day number (see data.ts) as YYYY-MM-DD */
export const isoDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  return body as T;
}

const overviews = new Map<string, { at: number; p: Promise<Overview> }>();

type LiveOverview = Extract<Overview, { live: true }>;
const liveListeners = new Set<(o: LiveOverview) => void>();
/** called with every live answer, whichever page asked (lets a failed first load recover) */
export function onLiveOverview(fn: (o: LiveOverview) => void) {
  liveListeners.add(fn);
  return () => {
    liveListeners.delete(fn);
  };
}

/** spend and leads for every ad account over [from, to]. Kept in the tab for a minute
    (the server re-reads Meta every 2 minutes for recent ranges). A failed answer, or one
    where some accounts couldn't be read, is not kept, so the next ask tries Meta again. */
export function loadOverview(from: string, to: string): Promise<Overview> {
  const key = `${from}|${to}`;
  const hit = overviews.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = get<Overview>(`/api/meta/overview?from=${from}&to=${to}`).catch(
    (e: Error): Overview => ({ live: false, reason: "meta-error", message: `Couldn't load Meta data. ${e.message}` })
  );
  overviews.set(key, { at: Date.now(), p });
  p.then((o) => {
    if (o.live) liveListeners.forEach((fn) => fn(o));
    const partial = o.live && !!o.errors?.length;
    if ((partial || (!o.live && o.reason === "meta-error")) && overviews.get(key)?.p === p) overviews.delete(key);
  });
  return p;
}

let roster: { at: number; p: Promise<AccountList> } | null = null;

/** the ad accounts only (fast): decides live vs dummy and fills Clients and Calendar */
export function loadAccounts(): Promise<AccountList> {
  if (roster && Date.now() - roster.at < 60000) return roster.p;
  const p = get<AccountList>("/api/meta/accounts").catch(
    (e: Error): AccountList => ({ live: false, reason: "meta-error", message: `Couldn't load Meta data. ${e.message}` })
  );
  const entry = { at: Date.now(), p };
  roster = entry;
  p.then((a) => {
    if (!a.live && a.reason === "meta-error" && roster === entry) roster = null;
  });
  return p;
}

function once<T>(cache: Map<string, Promise<T>>, key: string, url: string) {
  let p = cache.get(key);
  if (!p) {
    p = get<T>(url);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

const details = new Map<string, Promise<AccountDetails>>();
/** statuses and thumbnails for one ad account ("act_123"), fetched the first time it opens */
export const loadDetails = (accountId: string) =>
  once(details, accountId, `/api/meta/account/${accountId.replace(/^act_/, "")}`);

const previews = new Map<string, Promise<AdPreview>>();
/** Meta's preview of one ad (its signed URL lasts about a day) */
export const loadPreview = (adId: string) => once(previews, adId, `/api/meta/preview/${adId}`);
