"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarMenu } from "@/components/CalendarMenu";
import { DemoBadge } from "@/components/DemoBadge";
import { GhlMenu } from "@/components/GhlMenu";
import { STATUS, StatusMenu } from "@/components/StatusMenu";
import { V2Brand, V2Icon } from "@/components/v2/icons";
import { v2toast } from "@/components/v2/Toast";
import type { Account } from "@/lib/data";
import { initials } from "@/lib/format";
import { calendarsFor } from "@/lib/ghl";
import { displayName, useTracker } from "@/lib/store";

function ClientRow({ a }: { a: Account }) {
  const { setName, setStatus, ghlAccounts, ghlOf, setGhl, calendarsOf, setCalendars, setRemoved } = useTracker();
  const ghl = ghlOf(a.id);
  const [val, setVal] = useState(a.businessName);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef(false);

  /* follow saved changes unless the field is being edited */
  useEffect(() => {
    if (document.activeElement !== input.current) setVal(a.businessName);
  }, [a.businessName]);

  const commit = () => {
    if (cancel.current) {
      cancel.current = false;
      return;
    }
    const v = val.trim();
    if (v === a.businessName.trim()) {
      setVal(a.businessName);
      return;
    }
    setName(a.id, v);
    /* cleared on a linked client: the name goes back to the GHL account's */
    setVal(v || ghl?.name || "");
    v2toast(v ? "Business name saved" : ghl ? "Showing the GHL account name instead" : "Showing the ad account name instead");
  };

  return (
    <tr>
      <td>
        <div className="at-who">
          <span className={`ld-av at-c${a.tone}`}>{initials(displayName({ ...a, businessName: val }))}</span>
          <label className="st-in at-cin">
            <input
              ref={input}
              value={val}
              placeholder="Add business name"
              size={Math.max(val.length, 17)}
              spellCheck={false}
              aria-label={`Business name for ${a.adAccountName}`}
              onChange={(e) => setVal(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  cancel.current = true;
                  setVal(a.businessName);
                  e.currentTarget.blur();
                }
              }}
            />
            <V2Icon name="pencil" />
          </label>
        </div>
      </td>
      <td>
        <GhlMenu accounts={ghlAccounts} match={a.adAccountName} value={ghl?.id} onChange={(g) => setGhl(a.id, g)} />
      </td>
      <td>
        <span className="at-acct" data-tip="Pulled from Meta. Rename it in Meta.">
          <V2Brand name="meta" />
          <span>{a.adAccountName}</span>
        </span>
      </td>
      <td>
        <CalendarMenu
          calendars={ghl ? calendarsFor(ghl.id) : []}
          value={calendarsOf(a.id)}
          onChange={(ids) => setCalendars(a.id, ids)}
          locked={ghl ? undefined : "Pick the GHL account first"}
        />
      </td>
      <td>
        <StatusMenu
          value={a.status}
          onChange={(s) => {
            setStatus(a.id, s);
            v2toast(`${displayName(a)} set to ${STATUS.find((x) => x[0] === s)?.[1]}`);
          }}
        />
      </td>
      <td>
        <div className="ld-acts">
          <button
            type="button"
            className="ld-ico ld-del"
            aria-label={`Remove ${displayName(a)}`}
            onClick={() => {
              setRemoved(a.id, true);
              v2toast(`${displayName(a)} removed. Add it back under Removed`, "trash");
            }}
          >
            <V2Icon name="x" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ClientsPage() {
  const { ready, accounts, removed, source, error, setRemoved } = useTracker();
  const by = (s: string) => accounts.filter((a) => a.status === s).length;
  const counted = ready && source !== "error";

  return (
    <section className="dash ld at-page">
      <div className="greet">
        <h1>
          Clients
          <span>Your client roster</span>
        </h1>
        <DemoBadge />
      </div>

      <div className="rp-sec">
        <h3 className="ul-t">{counted ? `${accounts.length} clients` : "Clients"}</h3>
        <span className="rp-k">
          {counted ? `${by("active")} active · ${by("paused")} paused · ${by("churned")} churned` : ""}
        </span>
      </div>

      <table className="rp-tbl ld-tbl at-ctbl">
        <thead>
          <tr>
            <th>Business name</th>
            <th>GHL account</th>
            <th>Ad account name</th>
            <th>Booking calendar</th>
            <th>Status</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <ClientRow key={a.id} a={a} />
          ))}
          {source === "error" && (
            <tr className="at-none">
              <td colSpan={6}>{error}</td>
            </tr>
          )}
        </tbody>
      </table>

      {removed.length > 0 && (
        <>
          <div className="rp-sec">
            <h3 className="ul-t">Removed</h3>
            <span className="rp-k">Hidden from the dashboard and calendar</span>
          </div>
          <table className="rp-tbl ld-tbl at-ctbl at-rtbl">
            <thead>
              <tr>
                <th>Business name</th>
                <th>Ad account name</th>
                <th aria-label="Add back" />
              </tr>
            </thead>
            <tbody>
              {removed.map((a, i) => (
                <tr key={a.id} className="at-in" style={{ "--i": i } as React.CSSProperties}>
                  <td>
                    <div className="at-who">
                      <span className={`ld-av at-c${a.tone}`}>{initials(displayName(a))}</span>
                      <b className="at-rname">{displayName(a)}</b>
                    </div>
                  </td>
                  <td>
                    <span className="at-acct">
                      <V2Brand name="meta" />
                      <span>{a.adAccountName}</span>
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ld-q"
                      onClick={() => {
                        setRemoved(a.id, false);
                        v2toast(`${displayName(a)} is back on the tracker`);
                      }}
                    >
                      <V2Icon name="plus" />
                      Add back
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
