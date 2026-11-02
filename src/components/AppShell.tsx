"use client";

import { TrackerProvider } from "@/lib/store";
import { Rail } from "./Rail";
import { V2Toast } from "./v2/Toast";
import { V2Tooltip } from "./v2/Tooltip";

/* proto layout: black frame, icon rail on the left, light rounded shell */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TrackerProvider>
      <div className="v2-root h-full">
        <div className="app">
          <Rail />
          <main className="shell dash-on">{children}</main>
        </div>
        <V2Toast />
        <V2Tooltip />
      </div>
    </TrackerProvider>
  );
}
