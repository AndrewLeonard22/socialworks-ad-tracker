"use client";

import { useEffect, useRef, useState } from "react";
import { suggestedFor } from "@/lib/ghl";
import type { GhlAccount } from "@/lib/ghl";
import { V2Icon } from "./v2/icons";

/* GHL account picker for a client: the same table-cell picker and menu as the
   booking calendar, but a client links to one sub-account, so picking closes
   the menu (clicking the linked one again unlinks it). Sub-accounts named like
   the ad account are listed first as suggestions. */
export function GhlMenu({
  accounts,
  match,
  value,
  onChange,
}: {
  accounts: GhlAccount[];
  /** the client's ad account name, for the suggestions */
  match: string;
  value?: string;
  onChange: (id: string | null) => void;
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

  const picked = accounts.find((g) => g.id === value);
  const suggested = seen ? suggestedFor(match, accounts) : [];
  const others = seen ? accounts.filter((g) => !suggested.includes(g)) : [];

  const item = (g: GhlAccount) => {
    const on = g.id === value;
    return (
      <button
        key={g.id}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        onMouseEnter={(e) => hover(e.currentTarget)}
        onClick={() => {
          setOpen(false);
          onChange(on ? null : g.id);
        }}
      >
        <span className="ld-ck">{on && <V2Icon name="check" />}</span>
        {g.name}
      </button>
    );
  };

  return (
    <div ref={ref} className={`ld-pop ld-ask at-calm at-ghlm${open ? " open" : ""}${up ? " up" : ""}`}>
      <button
        type="button"
        className={`ld-stb ld-oc${picked ? " set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setUp(!!r && r.bottom + 380 > window.innerHeight);
          setSeen(true);
          setOpen((o) => !o);
        }}
      >
        <span>{picked ? picked.name : "Pick account"}</span>
        <V2Icon name="chevD" />
      </button>
      <div className="menu" role="menu" onMouseLeave={() => mh.current?.classList.remove("on")}>
        <i className="mh" ref={mh} aria-hidden="true" />
        {suggested.length > 0 && <h6>Suggested · name match</h6>}
        {suggested.map(item)}
        {others.length > 0 && <h6>{suggested.length ? "Other accounts" : "All accounts"}</h6>}
        {others.map(item)}
      </div>
    </div>
  );
}
