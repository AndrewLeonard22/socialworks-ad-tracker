"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { DemoBadge } from "@/components/DemoBadge";
import { V2Icon } from "@/components/v2/icons";
import { appointmentsBetween, dateOf, dayNumOf } from "@/lib/data";
import type { Appointment } from "@/lib/data";
import { fmtTime } from "@/lib/format";
import { isoDay, loadCalendarDays } from "@/lib/live";
import type { CalAppt } from "@/lib/live";
import { displayName, useTracker } from "@/lib/store";

/** a GHL appointment in the calendar's shape (its local YYYY-MM-DD as a day number) */
const fromGhl = (a: CalAppt): Appointment => ({
  id: a.id,
  accountId: a.acct,
  day: Math.floor(Date.parse(`${a.date}T00:00:00Z`) / 86400000),
  min: a.min,
  lead: a.lead,
  type: a.type,
});

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX = 3;

const shortTime = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${m.toString().padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function CalendarPage() {
  const { ready, today, accounts, source, crm } = useTracker();
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  const t = dateOf(today);
  const first = new Date(t.getFullYear(), t.getMonth() + offset, 1);
  const gridStart = dayNumOf(first) - first.getDay();
  const sel = picked ?? today;

  /* live: the real appointments on each client's picked GHL calendars, for the six
     weeks on screen (and the picked day when paging leaves it off the grid). What's
     already loaded stays put while another month loads; dummy mode keeps its samples. */
  const live = ready && source === "live";
  const [real, setReal] = useState<Map<string, Appointment>>(() => new Map());
  const keep = (list: CalAppt[]) =>
    setReal((m) => {
      const next = new Map(m);
      for (const a of list) next.set(a.id, fromGhl(a));
      return next;
    });
  const gridFrom = isoDay(gridStart);
  const gridTo = isoDay(gridStart + 41);
  useEffect(() => {
    if (!live) return;
    let on = true;
    loadCalendarDays(gridFrom, gridTo).then((r) => {
      if (!on || !r.ok) return;
      /* this range's answer replaces whatever was kept for these days */
      setReal((m) => {
        const next = new Map([...m].filter(([, ev]) => ev.day < gridStart || ev.day > gridStart + 41));
        for (const a of r.appointments) next.set(a.id, fromGhl(a));
        return next;
      });
    });
    return () => {
      on = false;
    };
  }, [live, gridFrom, gridTo, gridStart]);
  const selOff = sel < gridStart || sel > gridStart + 41;
  useEffect(() => {
    if (!live || !selOff) return;
    let on = true;
    loadCalendarDays(isoDay(sel), isoDay(sel)).then((r) => on && r.ok && keep(r.appointments));
    return () => {
      on = false;
    };
  }, [live, selOff, sel]);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const byDay = useMemo(() => {
    const m = new Map<number, Appointment[]>();
    if (!ready) return m;
    const list = live
      ? [...real.values()]
          .filter((ev) => byId.has(ev.accountId) && ev.day >= gridStart && ev.day <= gridStart + 41)
          .sort((a, b) => a.day - b.day || a.min - b.min)
      : appointmentsBetween(accounts, gridStart, gridStart + 41, today);
    for (const ev of list) {
      const day = m.get(ev.day);
      if (day) day.push(ev);
      else m.set(ev.day, [ev]);
    }
    return m;
  }, [ready, live, real, byId, accounts, gridStart, today]);

  /* the selected day can sit outside the visible grid (e.g. after paging months) */
  const selEvents = useMemo(() => {
    if (!ready) return [];
    if (byDay.has(sel)) return byDay.get(sel)!;
    if (!live) return appointmentsBetween(accounts, sel, sel, today);
    return [...real.values()].filter((ev) => ev.day === sel && byId.has(ev.accountId)).sort((a, b) => a.min - b.min);
  }, [ready, live, real, byId, byDay, sel, accounts, today]);

  const monthFrom = dayNumOf(first);
  const monthTo = dayNumOf(new Date(first.getFullYear(), first.getMonth() + 1, 0));
  let monthCount = 0;
  let upcoming = 0;
  byDay.forEach((list, d) => {
    if (d < monthFrom || d > monthTo) return;
    monthCount += list.length;
    if (d >= today) upcoming += list.length;
  });

  const selDate = dateOf(sel);
  const tone = (id: string) => byId.get(id)?.tone ?? 6;
  const nameOf = (id: string) => {
    const a = byId.get(id);
    return a ? displayName(a) : "";
  };

  return (
    <section className="dash ld at-page">
      <div className="greet">
        <h1>
          Calendar
          <span>Upcoming client appointments</span>
        </h1>
        <DemoBadge sample ghl={crm.state === "on"} />
      </div>

      <div className="ld-bar at-calbar">
        <button
          type="button"
          className="obtn ld-fb"
          onClick={() => {
            setOffset(0);
            setPicked(null);
          }}
        >
          Today
        </button>
        <div className="at-mnav">
          <button type="button" className="at-arrow prev" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}>
            <V2Icon name="chevD" />
          </button>
          <button type="button" className="at-arrow next" aria-label="Next month" onClick={() => setOffset((o) => o + 1)}>
            <V2Icon name="chevD" />
          </button>
        </div>
        <h2 className="at-month">{ready ? first.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : ""}</h2>
        <span className="rp-k at-mcount">
          {ready ? `${plural(monthCount, "appointment")} · ${upcoming} upcoming` : ""}
        </span>
      </div>

      <div className="at-calwrap">
        <div className="at-cal" role="grid" aria-label="Appointments by day">
          <div className="at-dow" role="row">
            {DOW.map((d) => (
              <span key={d} role="columnheader">
                {d}
              </span>
            ))}
          </div>
          <div className="at-grid">
            {Array.from({ length: 42 }, (_, i) => {
              const n = gridStart + i;
              const d = dateOf(n);
              const evs = byDay.get(n) ?? [];
              const out = d.getMonth() !== first.getMonth();
              const cls = [
                "at-cell",
                out ? "out" : "",
                n === today ? "today" : "",
                n === sel ? "sel" : "",
                n < today ? "past" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={n}
                  className={cls}
                  role="gridcell"
                  tabIndex={0}
                  aria-selected={n === sel}
                  aria-label={`${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}, ${plural(evs.length, "appointment")}`}
                  onClick={() => setPicked(n)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setPicked(n);
                  }}
                >
                  <span className="at-dn">{ready ? d.getDate() : ""}</span>
                  <span className="at-evs">
                    {evs.slice(0, evs.length > MAX ? MAX - 1 : MAX).map((ev) => (
                      <span key={ev.id} className={`at-ev at-c${tone(ev.accountId)}`}>
                        <b>{shortTime(ev.min)}</b>
                        <span>{nameOf(ev.accountId)}</span>
                      </span>
                    ))}
                    {evs.length > MAX && <span className="at-more">+{evs.length - MAX + 1} more</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="card at-agenda">
          <div className="ul-hd">
            <h3 className="ul-t">
              {!ready ? "" : sel === today ? "Today" : selDate.toLocaleDateString("en-US", { weekday: "long" })}
            </h3>
            <p className="ul-d">
              {ready
                ? `${selDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · ${plural(selEvents.length, "appointment")}`
                : ""}
            </p>
          </div>
          {selEvents.length ? (
            <ul className="ul-list at-alist" key={sel}>
              {selEvents.map((ev, i) => (
                <li key={ev.id} style={{ "--i": i } as CSSProperties}>
                  <span className="at-at">{fmtTime(ev.min)}</span>
                  <span className="at-aw">
                    <b>{nameOf(ev.accountId)}</b>
                    <small>
                      {ev.lead} · {ev.type}
                    </small>
                  </span>
                  <i className={`at-dot at-c${tone(ev.accountId)}`} />
                </li>
              ))}
            </ul>
          ) : (
            ready && <p className="at-empty">No appointments this day</p>
          )}
        </aside>
      </div>
    </section>
  );
}
