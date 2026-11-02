"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { loadPreview } from "@/lib/live";
import type { AdPreview as Frame } from "@/lib/live";
import { V2Icon } from "./v2/icons";

export interface PreviewAd {
  id: string;
  name: string;
  /** the line under the name: whose ad it is */
  sub: string;
}

/* The real Meta preview of one ad in the proto drawer (.scrim + .drawer).
   Meta signs the iframe URL and it expires after about a day, so it is
   fetched when the drawer opens. Escape, the X and the scrim close it. */
export function AdPreview({ ad, onClose }: { ad: PreviewAd | null; onClose: () => void }) {
  /* the last ad stays in the drawer while it slides out */
  const [shown, setShown] = useState(ad);
  if (ad && ad !== shown) setShown(ad);
  const [frame, setFrame] = useState<{ id: string; f?: Frame; error?: string } | null>(null);

  useEffect(() => {
    if (!ad) return;
    let on = true;
    loadPreview(ad.id).then(
      (f) => on && setFrame({ id: ad.id, f }),
      (e: Error) => on && setFrame({ id: ad.id, error: e.message })
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      on = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [ad, onClose]);

  const cur = frame && frame.id === shown?.id ? frame : null;

  return (
    <>
      <div className={`scrim${ad ? " on" : ""}`} onClick={onClose} />
      <aside
        className={`drawer${ad ? " on" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${shown?.name ?? "ad"}`}
        aria-hidden={!ad}
        inert={!ad}
      >
        <div className="dh">
          <div>
            <h2>{shown?.name}</h2>
            <p>{shown?.sub}</p>
          </div>
          <button type="button" className="x" aria-label="Close" onClick={onClose}>
            <V2Icon name="x" />
          </button>
        </div>
        <div className="db">
          {!ad ? null : cur?.f ? (
            <iframe
              key={cur.f.src}
              className="at-prev"
              src={cur.f.src}
              style={{ "--w": `${cur.f.width || 540}px` } as CSSProperties}
              title={`Meta preview of ${shown?.name}`}
            />
          ) : (
            <p className="at-empty">{cur?.error ?? "Loading the preview from Meta…"}</p>
          )}
        </div>
      </aside>
    </>
  );
}
