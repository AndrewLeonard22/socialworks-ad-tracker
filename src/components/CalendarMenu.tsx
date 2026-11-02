"use client";

import { useEffect, useRef, useState } from "react";
import { isInPerson } from "@/lib/ghl";
import type { BookingCalendar } from "@/lib/ghl";
import { V2Icon } from "./v2/icons";

/* Booking calendar picker for a client: the proto table-cell picker (.ld-oc,
   "pick something here") opening the same menu as the status dropdown, but
   multi-select: clicking a calendar ticks it and the menu stays open.
   In-person consultation calendars are listed first as suggestions.
   Calendars belong to a GHL account, so it stays locked until one is linked. */
export function CalendarMenu({
  calendars,
  value,
  onChange,
  locked,
}: {
  calendars: BookingCalendar[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** why it can't be used yet (its tooltip); the picker stays dimmed and shut */
  locked?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mh = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hover = (b: HTMLElement) => {
    const m = mh.current;
    if (!m) return;
    m.style.transform = `translate(${b.offsetLeft}px,${b.offsetTop}px)`;
    m.style.width = `${b.offsetWidth}px`;
    m.style.height = `${b.offsetHeight}px`;
    m.classList.add("on");
  };

  const picked = calendars.filter((c) => value.includes(c.id));
  const suggested = calendars.filter((c) => isInPerson(c.name));
  const others = calendars.filter((c) => !isInPerson(c.name));
  const label = !picked.length ? "Pick calendars" : picked.length === 1 ? picked[0].name : `${picked.length} calendars`;

  const item = (c: BookingCalendar) => {
    const on = value.includes(c.id);
    return (
      <button
        key={c.id}
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        onMouseEnter={(e) => hover(e.currentTarget)}
        onClick={() => onChange(on ? value.filter((id) => id !== c.id) : [...value, c.id])}
      >
        <span className="ld-ck">{on && <V2Icon name="check" />}</span>
        {c.name}
      </button>
    );
  };

  return (
    <div ref={ref} className={`ld-pop ld-ask at-calm${open && !locked ? " open" : ""}${up ? " up" : ""}`}>
      <button
        type="button"
        className={`ld-stb ld-oc${picked.length && !locked ? " set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open && !locked}
        aria-disabled={locked ? true : undefined}
        data-tip={locked || (picked.length > 1 ? picked.map((c) => c.name).join(", ") : undefined)}
        onClick={() => {
          if (locked) return;
          const r = ref.current?.getBoundingClientRect();
          setUp(!!r && r.bottom + 300 > window.innerHeight);
          setOpen((o) => !o);
        }}
      >
        <span>{label}</span>
        <V2Icon name="chevD" />
      </button>
      <div className="menu" role="menu" onMouseLeave={() => mh.current?.classList.remove("on")}>
        <i className="mh" ref={mh} aria-hidden="true" />
        {suggested.length > 0 && <h6>Suggested · in person</h6>}
        {suggested.map(item)}
        {others.length > 0 && <h6>Other calendars</h6>}
        {others.map(item)}
      </div>
    </div>
  );
}
