"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { preconnect } from "react-dom";
import type { CSSProperties } from "react";
import { AdPreview } from "@/components/AdPreview";
import type { PreviewAd } from "@/components/AdPreview";
import { DatePop, presetRange, rangeLabel } from "@/components/DatePop";
import type { Range } from "@/components/DatePop";
import { DemoBadge } from "@/components/DemoBadge";
import { STATUS } from "@/components/StatusMenu";
import { V2Icon } from "@/components/v2/icons";
import { emptyTotals, isRunning, rollup } from "@/lib/data";
import type { Account } from "@/lib/data";
import { derived, initials } from "@/lib/format";
import type { Metrics } from "@/lib/format";
import { isoDay, loadAppointments, loadDetails, loadOverview, loadPreview } from "@/lib/live";
import type { AccountDetails, CrmAppointments, MetaAccount, Overview } from "@/lib/live";
import { accountFromMeta, displayName, useTracker } from "@/lib/store";

const KPIS = [
  ["Total spend", "spend"],
  ["Total leads", "leads"],
  ["Avg. cost per lead", "cpl"],
  ["Total appointments", "appts"],
  ["Lead to appointment", "l2a"],
  ["Avg. cost per appointment", "cpa"],
  ["Closed deals", "closed"],
  ["Total revenue", "revenue"],
] as const;

const COLS = ["Spend", "Leads", "Cost per lead", "Appointments", "Lead to appt", "Cost per appt", "Closed deals", "Revenue"];

function Cells({ t }: { t: Metrics }) {
  const d = derived(t);
  return (
    <>
      <td>{d.spend}</td>
      <td>{d.leads}</td>
      <td>{d.cpl}</td>
      <td>{d.appts}</td>
      <td>{d.l2a}</td>
      <td>{d.cpa}</td>
      <td>{d.closed}</td>
      <td>{d.revenue}</td>
    </>
  );
}

function hl(text: string, q: string) {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="ld-hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* One row shape for both sources. Dummy rows know their status up front; live
   rows get it from Meta once their account is opened, and live ad sets hold ads. */
type St = { on: boolean; label: string };
interface AdRow {
  id: string;
  name: string;
  t: Metrics;
}
interface SetRow extends AdRow {
  st?: St;
  ads?: AdRow[];
}
interface CampaignRow extends AdRow {
  st?: St;
  sets: SetRow[];
}
interface Row {
  account: Account;
  t: Metrics;
  campaigns: CampaignRow[];
  /** this account could not be read from Meta */
  error?: string;
}

const running = (on: boolean): St => ({ on, label: on ? "Active" : "Paused" });

function dummyRows(accounts: Account[], from: number, to: number, today: number): Row[] {
  return rollup(accounts, from, to).map(({ account, t, campaigns }) => ({
    account,
    t,
    campaigns: campaigns.map(({ campaign: c, t: ct, sets }) => ({
      id: c.id,
      name: c.name,
      t: ct,
      st: running(c.adSets.some((s) => isRunning(s, today))),
      sets: sets.map(({ set, t: stt }) => ({ id: set.id, name: set.name, t: stt, st: running(isRunning(set, today)) })),
    })),
  }));
}

const sl = (n: { spend: number; leads: number }): Metrics => ({ spend: n.spend, leads: n.leads });

/** live rows; a client linked to GHL calendars also gets its appointments (account level only) */
function liveRows(list: MetaAccount[], byId: Map<string, Account>, booked: Record<string, string[]> | null): Row[] {
  return list.map((m) => ({
    account: byId.get(m.id) ?? accountFromMeta(m),
    t: m.error ? {} : booked?.[m.id] ? { ...sl(m), appts: booked[m.id].length } : sl(m),
    error: m.error,
    campaigns: m.campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      t: sl(c),
      sets: c.adsets.map((s) => ({
        id: s.id,
        name: s.name,
        t: sl(s),
        ads: s.ads.map((ad) => ({ id: ad.id, name: ad.name, t: sl(ad) })),
      })),
    })),
  }));
}

/** Meta effective_status as the dot and label the rows show (ACTIVE = green) */
function metaSt(s?: string): St | undefined {
  if (!s) return undefined;
  if (s === "ACTIVE") return { on: true, label: "Active" };
  if (s.endsWith("PAUSED")) return { on: false, label: "Paused" };
  const w = s.replace(/_/g, " ").toLowerCase();
  return { on: false, label: w[0].toUpperCase() + w.slice(1) };
}

/** add up the metrics `seed` has; the ones it leaves out stay missing ("–") */
function addUp(seed: Metrics, rows: Row[]) {
  const out = { ...seed };
  const keys = Object.keys(out) as (keyof Metrics)[];
  for (const r of rows) for (const key of keys) out[key] = (out[key] ?? 0) + (r.t[key] ?? 0);
  return out;
}

export default function DashboardPage() {
  const { ready, today, accounts, source, removedIds } = useTracker();
  const [picked, setPicked] = useState<Range | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dateOpen, setDateOpen] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  /* live: the latest Meta answer, each opened account's statuses + thumbnails, the ad being previewed */
  const [res, setRes] = useState<{ from: string; to: string; o: Overview } | null>(null);
  const [details, setDetails] = useState<Record<string, AccountDetails>>({});
  const [preview, setPreview] = useState<PreviewAd | null>(null);

  const range = picked ?? presetRange("30", today);
  const live = ready && source !== "dummy";
  const from = isoDay(range.from);
  const to = isoDay(range.to);

  /* Meta numbers for the picked range. The last answer stays on screen (dimmed)
     until the new one lands; an answer for an older pick is dropped. */
  useEffect(() => {
    if (!live) return;
    let on = true;
    loadOverview(from, to).then((o) => on && setRes({ from, to, o }));
    return () => {
      on = false;
    };
  }, [live, from, to]);
  /* appointments on each linked client's GHL calendars for the same range; the
     last answer stays until the new one lands, like the Meta numbers */
  const [appts, setAppts] = useState<CrmAppointments | null>(null);
  useEffect(() => {
    if (!live) return;
    let on = true;
    loadAppointments(from, to).then((a) => on && setAppts(a));
    return () => {
      on = false;
    };
  }, [live, from, to]);
  const booked = appts?.ok ? appts.booked : null;
  const loading = live && !!res && (res.from !== from || res.to !== to);
  /* nothing to show yet: the first answer (the row fades in late, so a quick answer never flashes it) */
  const waiting = source === "loading" ? today > 0 : live && !res;
  const failed = live && res && !res.o.live ? (res.o.reason === "meta-error" ? res.o.message : "Meta is not connected") : "";
  const hasNumbers = ready && (source === "dummy" || !!res?.o.live);
  /* accounts Meta couldn't read are left out of the totals: say so next to them */
  const notLoaded = live && res?.o.live ? (res.o.errors ?? []).filter((e) => !removedIds.has(e.id)).length : 0;

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const rows = useMemo(() => {
    if (!ready) return [];
    const list =
      source === "dummy"
        ? dummyRows(accounts, range.from, range.to, today)
        : res?.o.live
          ? liveRows(res.o.accounts.filter((m) => !removedIds.has(m.id)), byId, booked)
          : [];
    return list.sort((a, b) => (b.t.spend ?? -1) - (a.t.spend ?? -1));
  }, [ready, source, accounts, range.from, range.to, today, res, byId, removedIds, booked]);
  const query = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      !query ||
      displayName(r.account).toLowerCase().includes(query) ||
      r.account.adAccountName.toLowerCase().includes(query)
  );
  let k = derived(addUp(source === "dummy" ? emptyTotals() : { spend: 0, leads: 0 }, shown));
  /* live: appointment tiles cover only clients linked to GHL calendars (their spend and
     leads against their bookings), and a person booked on a shared calendar counts once */
  const linked = live && booked ? shown.filter((r) => booked[r.account.id]) : [];
  if (linked.length) {
    const people = new Set(linked.flatMap((r) => booked![r.account.id]));
    const d = derived({ ...addUp({ spend: 0, leads: 0 }, linked), appts: people.size });
    k = { ...k, appts: d.appts, l2a: d.l2a, cpa: d.cpa };
  }
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  /* a live account's statuses and thumbnails load when it is hovered or first opened;
     if Meta can't send them, the rows just go without (no endless placeholder) */
  const empty = (r: Row) => live && !r.error && !r.campaigns.length;
  const fetchDetails = (r: Row) => {
    const id = r.account.id;
    if (!live || r.error || !r.campaigns.length || details[id]) return;
    loadDetails(id).then(
      (d) => setDetails((m) => ({ ...m, [id]: d })),
      () => setDetails((m) => (m[id] ? m : { ...m, [id]: { status: {}, thumbs: {} } }))
    );
  };
  const toggleAccount = (r: Row) => {
    if (empty(r)) return;
    toggle(r.account.id);
    fetchDetails(r);
  };
  /* Meta's preview starts loading when a thumbnail is hovered */
  const warmPreview = (adId: string) => {
    preconnect("https://www.facebook.com");
    loadPreview(adId).catch(() => {});
  };
  const closePreview = useCallback(() => setPreview(null), []);

  return (
    <section className="dash ld at-page">
      <div className="greet">
        <h1>
          Dashboard
          <span>Meta ads across every client</span>
        </h1>
        <DemoBadge />
      </div>

      <div className="ld-bar">
        <label className="ld-search">
          <span className="ld-sic">
            <V2Icon name="search" />
          </span>
          <input
            type="search"
            placeholder="Search a business"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="ld-qx" hidden={!q} aria-label="Clear search" onClick={() => setQ("")}>
            <V2Icon name="x" />
          </button>
        </label>
        <div className="ld-ctl">
          <button
            type="button"
            className="obtn ld-fb d-period"
            aria-haspopup="dialog"
            aria-expanded={dateOpen}
            onClick={(e) => {
              setDateAnchor(e.currentTarget);
              setDateOpen((o) => !o);
            }}
          >
            <V2Icon name="calendar" />
            <span>{rangeLabel(range)}</span>
            <span className="chev">
              <V2Icon name="chevD" />
            </span>
          </button>
        </div>
      </div>

      <div className={`d-kpis${loading ? " at-dim" : ""}`}>
        {KPIS.map(([label, key], i) => (
          <div className="d-kpi" key={key} style={i > 3 ? { animationDelay: `${0.08 + i * 0.06}s` } : undefined}>
            <small>{label}</small>
            <b className="num">{hasNumbers ? k[key] : "–"}</b>
          </div>
        ))}
      </div>

      <div className="rp-sec">
        <h3 className="ul-t">Ad accounts</h3>
        <span className="rp-k">
          {hasNumbers ? `${plural(shown.length, "account")} · ${rangeLabel(range)}${notLoaded ? ` · ${notLoaded} didn't load` : ""}` : ""}
        </span>
      </div>

      <div className={`rp-tblw at-tblw${loading ? " at-dim" : ""}`} aria-busy={loading}>
        <table className="rp-tbl at-tbl">
          <thead>
            <tr>
              <th>Account</th>
              {COLS.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const { account: a, t, campaigns } = r;
              const name = displayName(a);
              const aOpen = !!open[a.id];
              const st = STATUS.find((s) => s[0] === a.status)?.[1];
              const sub = [
                a.businessName.trim() ? a.adAccountName : null,
                a.status !== "active" ? st : null,
                r.error ?? (empty(r) ? "No spend in this range" : plural(campaigns.length, "campaign")),
              ]
                .filter(Boolean)
                .join(" · ");
              const det = details[a.id];
              /* live rows whose Meta statuses are still on the way */
              const pending = live && !r.error && !det;
              /* dummy rows carry a status; live rows read Meta's once the account's details are in */
              const stOf = (x: { id: string; st?: St }) => x.st ?? metaSt(det?.status[x.id]);
              return (
                <Fragment key={a.id}>
                  <tr
                    className={`at-row at-l0${aOpen ? " open" : ""}${empty(r) ? " at-flat" : ""}`}
                    onClick={() => toggleAccount(r)}
                    onMouseEnter={() => fetchDetails(r)}
                  >
                    <td>
                      <button
                        type="button"
                        className="at-nm"
                        aria-expanded={empty(r) ? undefined : aOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAccount(r);
                        }}
                      >
                        <span className="at-chev">{!empty(r) && <V2Icon name="chevD" />}</span>
                        <span className={`ld-av at-c${a.tone}`}>{initials(name)}</span>
                        <span className="at-tx">
                          <b data-tip={name}>{hl(name, query)}</b>
                          <small>{sub}</small>
                        </span>
                      </button>
                    </td>
                    <Cells t={t} />
                  </tr>
                  {aOpen &&
                    campaigns.map((c, ci) => {
                      const cOpen = !!open[c.id];
                      const cst = stOf(c);
                      return (
                        <Fragment key={c.id}>
                          <tr
                            className={`at-row at-l1 at-in${cOpen ? " open" : ""}`}
                            style={{ "--i": ci } as CSSProperties}
                            onClick={() => toggle(c.id)}
                          >
                            <td>
                              <button
                                type="button"
                                className="at-nm"
                                aria-expanded={cOpen}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(c.id);
                                }}
                              >
                                <span className="at-chev">
                                  <V2Icon name="chevD" />
                                </span>
                                <span className="at-ic">
                                  <V2Icon name="megaphone" />
                                </span>
                                <span className="at-tx">
                                  <b data-tip={c.name}>{c.name}</b>
                                  <small>
                                    {cst && (
                                      <>
                                        <i className={`at-live${cst.on ? " on" : ""}`} />
                                        {cst.label} ·{" "}
                                      </>
                                    )}
                                    {plural(c.sets.length, "ad set")}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <Cells t={c.t} />
                          </tr>
                          {cOpen &&
                            c.sets.map((set, si) => {
                              const sst = stOf(set);
                              const sOpen = !!open[set.id];
                              const nm = (
                                <>
                                  <span className="at-chev">{set.ads && <V2Icon name="chevD" />}</span>
                                  <span className="at-ic">
                                    <V2Icon name="user" />
                                  </span>
                                  <span className="at-tx">
                                    <b data-tip={set.name}>{set.name}</b>
                                    <small>
                                      {sst ? (
                                        <>
                                          <i className={`at-live${sst.on ? " on" : ""}`} />
                                          {sst.label}
                                        </>
                                      ) : pending ? (
                                        <i className="at-skel" aria-hidden="true" />
                                      ) : (
                                        "\u00a0"
                                      )}
                                    </small>
                                  </span>
                                </>
                              );
                              return (
                                <Fragment key={set.id}>
                                  <tr
                                    className={`at-row at-l2 at-in${set.ads ? " at-exp" : ""}${sOpen ? " open" : ""}`}
                                    style={{ "--i": si } as CSSProperties}
                                    onClick={set.ads ? () => toggle(set.id) : undefined}
                                  >
                                    <td>
                                      {set.ads ? (
                                        <button
                                          type="button"
                                          className="at-nm"
                                          aria-expanded={sOpen}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggle(set.id);
                                          }}
                                        >
                                          {nm}
                                        </button>
                                      ) : (
                                        <div className="at-nm">{nm}</div>
                                      )}
                                    </td>
                                    <Cells t={set.t} />
                                  </tr>
                                  {sOpen &&
                                    set.ads?.map((ad, di) => {
                                      const dst = stOf(ad);
                                      const thumb = det?.thumbs[ad.id];
                                      return (
                                        <tr key={ad.id} className="at-row at-l3 at-in" style={{ "--i": di } as CSSProperties}>
                                          <td>
                                            <div className="at-nm">
                                              <span className="at-chev" />
                                              <button
                                                type="button"
                                                className="ad-ic"
                                                aria-label={`Preview ${ad.name}`}
                                                onMouseEnter={() => warmPreview(ad.id)}
                                                onFocus={() => warmPreview(ad.id)}
                                                onClick={() => setPreview({ id: ad.id, name: ad.name, sub: name })}
                                              >
                                                {thumb ? (
                                                  // eslint-disable-next-line @next/next/no-img-element
                                                  <img src={thumb} alt="" loading="lazy" />
                                                ) : (
                                                  <V2Icon name="image" />
                                                )}
                                              </button>
                                              <span className="at-tx">
                                                <b data-tip={ad.name}>{ad.name}</b>
                                                <small>
                                                  {dst ? (
                                                    <>
                                                      <i className={`at-live${dst.on ? " on" : ""}`} />
                                                      {dst.label}
                                                    </>
                                                  ) : pending ? (
                                                    <i className="at-skel" aria-hidden="true" />
                                                  ) : (
                                                    "\u00a0"
                                                  )}
                                                </small>
                                              </span>
                                            </div>
                                          </td>
                                          <Cells t={ad.t} />
                                        </tr>
                                      );
                                    })}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
            {(waiting || (ready && !shown.length)) && (
              <tr className={`at-none${waiting ? " at-wait" : ""}`}>
                <td colSpan={COLS.length + 1}>
                  {waiting ? (
                    "Loading from Meta…"
                  ) : failed ? (
                    failed
                  ) : rows.length ? (
                    <>No business matches &ldquo;{q.trim()}&rdquo;</>
                  ) : (
                    "No ad accounts are shared with this Meta token yet"
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DatePop
        open={dateOpen}
        anchor={dateAnchor}
        today={today}
        value={range}
        onApply={(r) => {
          setPicked(r);
          setDateOpen(false);
        }}
        onClose={() => setDateOpen(false)}
      />
      <AdPreview ad={preview} onClose={closePreview} />
    </section>
  );
}
