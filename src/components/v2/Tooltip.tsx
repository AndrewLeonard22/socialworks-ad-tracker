"use client";

import { useEffect, useRef } from "react";

const TIP_SEL = '[data-tip],button[aria-label],[role="button"][aria-label]';

export function V2Tooltip() {
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const root = document.querySelector(".v2-root");
    const box = boxRef.current;
    if (!root || !box) return;

    const tipText = (el: Element) =>
      el.getAttribute("data-tip") ||
      (el instanceof HTMLElement && el.offsetParent === null ? "" : el.getAttribute("aria-label")) ||
      "";

    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement).closest?.(TIP_SEL);
      if (!el) return;
      const text = tipText(el);
      if (!text) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const r = el.getBoundingClientRect();
        box.textContent = text;
        box.style.left = "0px";
        box.style.top = "0px";
        box.classList.add("on");
        const w = box.offsetWidth;
        const h = box.offsetHeight;
        let top = r.top - h - 10;
        let below = false;
        if (top < 8) {
          top = r.bottom + 10;
          below = true;
        }
        const left = Math.max(
          8,
          Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)
        );
        box.style.left = left + "px";
        box.style.top = top + "px";
        box.style.setProperty("--ax", r.left + r.width / 2 - left + "px");
        box.classList.toggle("below", below);
      }, 350);
    };
    const onOut = () => {
      if (timer.current) clearTimeout(timer.current);
      box.classList.remove("on");
    };

    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseout", onOut);
    root.addEventListener("focusin", onOver);
    root.addEventListener("focusout", onOut);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      root.removeEventListener("focusin", onOver);
      root.removeEventListener("focusout", onOut);
    };
  }, []);

  return <div ref={boxRef} className="tt" role="tooltip" />;
}
