"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { V2Icon } from "./v2/icons";
import { dateOf, dayNumOf, HISTORY_DAYS } from "@/lib/data";
import { fmtDay } from "@/lib/format";

/** inclusive day-number range; key is a preset id or "custom" */
export interface Range {
  key: string;
  from: number;
  to: number;
}

/* proto DP_PRESETS, verbatim */
export const PRESETS: [string, string, number][] = [
  ["7", "Last 7 days", 7],
  ["30", "Last 30 days", 30],
  ["90", "Last 3 months", 90],
];

/* "Last N days" ends yesterday, the same days as Ads Manager's presets */
export const presetRange = (key: string, today: number): Range => {
  const n = PRESETS.find((p) => p[0] === key)?.[2] ?? 30;
  return { key, from: today - n, to: today - 1 };
};

export const rangeLabel = (r: Range) =>
  PRESETS.find((p) => p[0] === r.key)?.[1] ??
  (r.from === r.to ? fmtDay(r.from) : `${fmtDay(r.from)} – ${fmtDay(r.to)}`);

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type Draft = { key: string; from: number; to: number | null };

/* period picker: presets + a one-month range calendar (proto .dpop) */
export function DatePop({
  open,
  anchor,
  today,
  value,
  onApply,
  onClose,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  today: number;
  value: Range;
  onApply: (r: Range) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<Draft>(value);
  const [view, setView] = useState(() => monthOf(value.to));
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wasOpen = useRef(false);

  /* fresh draft every time it opens */
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setDraft(value);
      setView(monthOf(value.to));
    }
  }

  const place = useCallback(() => {
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    setPos({
      top: r.bottom + 10,
      left: Math.max(16, Math.min(window.innerWidth - w - 16, r.right - w)),
    });
  }, [anchor]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose, place]);

  /* the white pill slides to the active preset; it jumps into place on open */
  useLayoutEffect(() => {
    const ind = indRef.current;
    const btn = preRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (!ind) return;
    const jump = open && !wasOpen.current;
    wasOpen.current = open;
    if (jump) ind.style.transition = "none";
    ind.style.opacity = btn ? "1" : "0";
    if (btn) ind.style.transform = `translateY(${btn.offsetTop}px)`;
    if (jump) {
      void ind.offsetWidth;
      ind.style.transition = "";
    }
  }, [draft.key, open]);

  const earliest = today - HISTORY_DAYS + 1;
  const first = new Date(view.y, view.m, 1);
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const canPrev = dayNumOf(first) > earliest;
  const canNext = !(view.y === dateOf(today).getFullYear() && view.m === dateOf(today).getMonth());
  const lo = draft.from;
  const hi = draft.to ?? draft.from;

  const pickDay = (n: number) => {
    if (draft.to !== null || draft.key !== "custom") setDraft({ key: "custom", from: n, to: null });
    else if (n < draft.from) setDraft({ key: "custom", from: n, to: draft.from });
    else setDraft({ key: "custom", from: draft.from, to: n });
  };

  const shift = (d: number) => setView((v) => monthOf(dayNumOf(new Date(v.y, v.m + d, 1))));

  const footer =
    draft.to === null
      ? `${fmtDay(lo)} · pick an end date`
      : lo === hi
        ? fmtDay(lo, true)
        : `${fmtDay(lo)} – ${fmtDay(hi, true)}`;

  return (
    <div
      ref={popRef}
      className={`dpop${open ? " on" : ""}`}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
      aria-label="Choose a date range"
      aria-hidden={!open}
      inert={!open}
    >
      <div className="dp-pre" ref={preRef}>
        <i className="dp-ind" ref={indRef} aria-hidden="true" />
        {PRESETS.map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            aria-pressed={draft.key === k}
            onClick={() => {
              setDraft({ key: k, from: today - n, to: today - 1 });
              setView(monthOf(today));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dp-cal">
        <div className="dp-hd">
          <button type="button" className="prev" aria-label="Previous month" disabled={!canPrev} onClick={() => shift(-1)}>
            <V2Icon name="chevD" />
          </button>
          <b>{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b>
          <button type="button" className="next" aria-label="Next month" disabled={!canNext} onClick={() => shift(1)}>
            <V2Icon name="chevD" />
          </button>
        </div>
        <div className="dp-grid">
          {DOW.map((d) => (
            <span key={d}>{d}</span>
          ))}
          {Array.from({ length: first.getDay() }, (_, i) => (
            <i key={`b${i}`} />
          ))}
          {Array.from({ length: daysIn }, (_, i) => {
            const n = dayNumOf(new Date(view.y, view.m, i + 1));
            const cls = [
              n > lo && n < hi ? "in" : "",
              n === lo ? "s" : "",
              n === hi ? "e" : "",
              n === today ? "today" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={n}
                type="button"
                className={cls || undefined}
                disabled={n > today || n < earliest}
                onClick={() => pickDay(n)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="dp-ft">
          <small>{footer}</small>
          <button
            type="button"
            className="cta"
            onClick={() => onApply({ key: draft.key, from: lo, to: hi })}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function monthOf(n: number) {
  const d = dateOf(n);
  return { y: d.getFullYear(), m: d.getMonth() };
}
