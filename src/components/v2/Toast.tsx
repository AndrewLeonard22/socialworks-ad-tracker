"use client";

import { useEffect, useRef, useState } from "react";
import { V2Icon } from "./icons";

let push: ((msg: string, icon?: string) => void) | null = null;

export function v2toast(msg: string, icon = "check") {
  push?.(msg, icon);
}

export function V2Toast() {
  const [state, setState] = useState<{ msg: string; icon: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    push = (msg, icon = "check") => {
      setState({ msg, icon });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(null), 2600);
    };
    return () => {
      push = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      className={`toast${state ? " on" : ""}`}
      role="status"
      aria-live="polite"
    >
      {state && (
        <>
          <V2Icon name={state.icon} size={18} />
          <span>{state.msg}</span>
        </>
      )}
    </div>
  );
}
