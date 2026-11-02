"use client";

import { useEffect, useRef, useState } from "react";
import { suggestedFor } from "@/lib/ghl";
import type { GhlAccount } from "@/lib/ghl";
import { V2Icon } from "./v2/icons";

/** open upward only when the menu (as tall as tracker.css lets it get) won't fit below
    the picker inside the page's scroll area but has more room above */
function opensUp(el: HTMLElement | null) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const box = el.closest(".dash")?.getBoundingClientRect();
  const top = Math.max(box?.top ?? 0, 0);
  const bottom = Math.min(box?.bottom ?? window.innerHeight, window.innerHeight);
  const menu = Math.min(360, window.innerHeight * 0.46) + 16;
  const below = bottom - r.bottom;
  return below < menu && r.top - top > below;
}

/* GHL account picker for a client: the same table-cell picker and menu as the
   booking calendar, but a client links to one sub-account, so picking closes
   the menu (clicking the linked one again unlinks it). Sub-accounts named like
   the ad account are listed first as suggestions. */
export function GhlMenu({
  accounts,
  match,
  value,
  onChange,
  locked,
  note,
}: {
  accounts: GhlAccount[];
  /** the client's ad account name, for the suggestions */
  match: string;
  /** the linked sub-account (shown even before the list arrives) */
  value?: GhlAccount;
  onChange: (account: GhlAccount | null) => void;
  /** why it can't be used yet (its tooltip); the picker stays dimmed and shut */
  locked?: string;
  /** a quiet line in the menu, e.g. while the sub-accounts load */
  note?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mh = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  /* the list is built on first open (one per row adds up), then kept so closing still animates */
  const [seen, setSeen] = useState(false);

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

  const picked = value ? (accounts.find((g) => g.id === value.id) ?? value) : undefined;
  const suggested = seen ? suggestedFor(match, accounts) : [];
  const others = seen ? accounts.filter((g) => !suggested.includes(g)) : [];

  const item = (g: GhlAccount) => {
    const on = g.id === value?.id;
    return (
      <button
        key={g.id}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        onMouseEnter={(e) => hover(e.currentTarget)}
        onClick={() => {
          setOpen(false);
          onChange(on ? null : g);
        }}
      >
        <span className="ld-ck">{on && <V2Icon name="check" />}</span>
        {g.name}
      </button>
    );
  };

  return (
    <div ref={ref} className={`ld-pop ld-ask at-calm at-ghlm${open && !locked ? " open" : ""}${up ? " up" : ""}`}>
      <button
        type="button"
        className={`ld-stb ld-oc${picked && !locked ? " set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open && !locked}
        aria-disabled={locked ? true : undefined}
        data-tip={locked}
        onClick={() => {
          if (locked) return;
          setUp(opensUp(ref.current));
          setSeen(true);
          setOpen((o) => !o);
        }}
      >
        <span>{picked ? picked.name : "Pick account"}</span>
        <V2Icon name="chevD" />
      </button>
      <div className="menu" role="menu" onMouseLeave={() => mh.current?.classList.remove("on")}>
        <i className="mh" ref={mh} aria-hidden="true" />
        {note && <p className="at-note">{note}</p>}
        {suggested.length > 0 && <h6>Suggested · name match</h6>}
        {suggested.map(item)}
        {others.length > 0 && <h6>{suggested.length ? "Other accounts" : "All accounts"}</h6>}
        {others.map(item)}
      </div>
    </div>
  );
}
