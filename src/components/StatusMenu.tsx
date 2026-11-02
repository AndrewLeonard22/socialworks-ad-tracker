"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientStatus } from "@/lib/data";
import { V2Icon } from "./v2/icons";

export const STATUS: [ClientStatus, string, string][] = [
  ["active", "Active", "good"],
  ["paused", "Paused", "warn"],
  ["churned", "Churned", "gray"],
];

/* proto lead status dropdown (.ld-pop.ld-sts): tinted pill, menu with a sliding hover fill */
export function StatusMenu({
  value,
  onChange,
}: {
  value: ClientStatus;
  onChange: (s: ClientStatus) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mh = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const cur = STATUS.find((s) => s[0] === value) ?? STATUS[0];

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

  return (
    <div ref={ref} className={`ld-pop ld-sts ld-ask${open ? " open" : ""}${up ? " up" : ""}`}>
      <button
        type="button"
        className={`ld-stb ld-st ${cur[2]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setUp(!!r && r.bottom + 180 > window.innerHeight);
          setOpen((o) => !o);
        }}
      >
        {cur[1]}
        <V2Icon name="chevD" />
      </button>
      <div className="menu" role="menu" onMouseLeave={() => mh.current?.classList.remove("on")}>
        <i className="mh" ref={mh} aria-hidden="true" />
        {STATUS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="menuitemradio"
            aria-checked={k === value}
            onMouseEnter={(e) => hover(e.currentTarget)}
            onClick={() => {
              setOpen(false);
              if (k !== value) onChange(k);
            }}
          >
            <span className="ld-ck">{k === value && <V2Icon name="check" />}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
