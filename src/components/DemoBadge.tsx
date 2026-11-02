"use client";

import { useTracker } from "@/lib/store";

/* Header pill. Without a Meta token every number is generated: orange "Dummy
   data". With one, the dashboard and clients are live: green "Live from Meta".
   The calendar's appointments stay sample data either way (`sample`). */
export function DemoBadge({ sample = false }: { sample?: boolean }) {
  const { source } = useTracker();
  if (source === "dummy")
    return (
      <span
        className="status at-demo"
        data-tip="Sample numbers only. Meta, appointments, closed deals and revenue are not connected yet."
      >
        Dummy data
      </span>
    );
  if (source !== "live") return null;
  if (sample)
    return (
      <span className="status at-demo" data-tip="Sample appointments. The calendar is not connected yet.">
        Dummy data
      </span>
    );
  return (
    <span
      className="status ok at-demo"
      data-tip="Spend, leads and cost per lead are live from Meta. Appointments, closed deals and revenue come later."
    >
      Live from Meta
    </span>
  );
}
