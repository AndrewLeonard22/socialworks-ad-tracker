import { useSyncExternalStore } from "react";

/* Artifact build only: #calendar / #clients map onto the Next.js routes */
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const read = () => {
  const h = window.location.hash.replace(/^#/, "");
  return h === "calendar" || h === "clients" ? `/${h}` : "/";
};

export function usePathname() {
  return useSyncExternalStore(subscribe, read, () => "/");
}
