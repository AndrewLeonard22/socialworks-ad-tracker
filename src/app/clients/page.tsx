"use client";

import { useEffect, useRef, useState } from "react";
import { DemoBadge } from "@/components/DemoBadge";
import { STATUS, StatusMenu } from "@/components/StatusMenu";
import { V2Brand, V2Icon } from "@/components/v2/icons";
import { v2toast } from "@/components/v2/Toast";
import type { Account } from "@/lib/data";
import { initials } from "@/lib/format";
import { displayName, useTracker } from "@/lib/store";

function ClientRow({ a }: { a: Account }) {
  const { setName, setStatus } = useTracker();
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
    setVal(v);
    if (v === a.businessName.trim()) return;
    setName(a.id, v);
    v2toast(v ? "Business name saved" : "Showing the ad account name instead");
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
        <span className="at-acct" data-tip="Pulled from Meta. Rename it in Meta.">
          <V2Brand name="meta" />
          <span>{a.adAccountName}</span>
        </span>
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
    </tr>
  );
}

export default function ClientsPage() {
  const { ready, accounts } = useTracker();
  const by = (s: string) => accounts.filter((a) => a.status === s).length;

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
        <h3 className="ul-t">{ready ? `${accounts.length} clients` : "Clients"}</h3>
        <span className="rp-k">
          {ready ? `${by("active")} active · ${by("paused")} paused · ${by("churned")} churned` : ""}
        </span>
      </div>

      <table className="rp-tbl ld-tbl at-ctbl">
        <thead>
          <tr>
            <th>Business name</th>
            <th>Ad account name</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <ClientRow key={a.id} a={a} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
