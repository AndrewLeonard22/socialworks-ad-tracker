"use client";

import { Fragment, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { DatePop, presetRange, rangeLabel } from "@/components/DatePop";
import type { Range } from "@/components/DatePop";
import { DemoBadge } from "@/components/DemoBadge";
import { STATUS } from "@/components/StatusMenu";
import { V2Icon } from "@/components/v2/icons";
import { addTotals, emptyTotals, isRunning, rollup } from "@/lib/data";
import type { Totals } from "@/lib/data";
import { derived, initials } from "@/lib/format";
import { displayName, useTracker } from "@/lib/store";

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

function Cells({ t }: { t: Totals }) {
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

export default function DashboardPage() {
  const { ready, today, accounts } = useTracker();
  const [picked, setPicked] = useState<Range | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dateOpen, setDateOpen] = useState(false);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);

  const range = picked ?? presetRange("30", today);
  const rows = useMemo(
    () => (ready ? rollup(accounts, range.from, range.to).sort((a, b) => b.t.spend - a.t.spend) : []),
    [ready, accounts, range.from, range.to]
  );
  const query = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      !query ||
      displayName(r.account).toLowerCase().includes(query) ||
      r.account.adAccountName.toLowerCase().includes(query)
  );
  const k = derived(shown.reduce((acc, r) => addTotals(acc, r.t), emptyTotals()));
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

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

      <div className="d-kpis">
        {KPIS.map(([label, key], i) => (
          <div className="d-kpi" key={key} style={i > 3 ? { animationDelay: `${0.08 + i * 0.06}s` } : undefined}>
            <small>{label}</small>
            <b className="num">{ready ? k[key] : "–"}</b>
          </div>
        ))}
      </div>

      <div className="rp-sec">
        <h3 className="ul-t">Ad accounts</h3>
        <span className="rp-k">
          {ready ? `${plural(shown.length, "account")} · ${rangeLabel(range)}` : ""}
        </span>
      </div>

      <div className="rp-tblw at-tblw">
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
            {shown.map(({ account: a, t, campaigns }) => {
              const name = displayName(a);
              const aOpen = !!open[a.id];
              const st = STATUS.find((s) => s[0] === a.status)?.[1];
              const sub = [
                a.businessName.trim() ? a.adAccountName : null,
                a.status !== "active" ? st : null,
                plural(campaigns.length, "campaign"),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Fragment key={a.id}>
                  <tr className={`at-row at-l0${aOpen ? " open" : ""}`} onClick={() => toggle(a.id)}>
                    <td>
                      <button
                        type="button"
                        className="at-nm"
                        aria-expanded={aOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(a.id);
                        }}
                      >
                        <span className="at-chev">
                          <V2Icon name="chevD" />
                        </span>
                        <span className={`ld-av at-c${a.tone}`}>{initials(name)}</span>
                        <span className="at-tx">
                          <b>{hl(name, query)}</b>
                          <small>{sub}</small>
                        </span>
                      </button>
                    </td>
                    <Cells t={t} />
                  </tr>
                  {aOpen &&
                    campaigns.map(({ campaign: c, t: ct, sets }, ci) => {
                      const cOpen = !!open[c.id];
                      const live = c.adSets.some((s) => isRunning(s, today));
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
                                  <b>{c.name}</b>
                                  <small>
                                    <i className={`at-live${live ? " on" : ""}`} />
                                    {live ? "Active" : "Paused"} · {plural(sets.length, "ad set")}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <Cells t={ct} />
                          </tr>
                          {cOpen &&
                            sets.map(({ set, t: stt }, si) => {
                              const on = isRunning(set, today);
                              return (
                                <tr key={set.id} className="at-row at-l2 at-in" style={{ "--i": si } as CSSProperties}>
                                  <td>
                                    <div className="at-nm">
                                      <span className="at-chev" />
                                      <span className="at-ic">
                                        <V2Icon name="user" />
                                      </span>
                                      <span className="at-tx">
                                        <b>{set.name}</b>
                                        <small>
                                          <i className={`at-live${on ? " on" : ""}`} />
                                          {on ? "Active" : "Paused"}
                                        </small>
                                      </span>
                                    </div>
                                  </td>
                                  <Cells t={stt} />
                                </tr>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
            {ready && !shown.length && (
              <tr className="at-none">
                <td colSpan={COLS.length + 1}>No business matches &ldquo;{q.trim()}&rdquo;</td>
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
    </section>
  );
}
