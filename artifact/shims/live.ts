import type { Overview } from "../../src/lib/live";

/* Artifact build only: a static page has no /api/meta routes, so it always runs on the dummy data */
export * from "../../src/lib/live";
export const loadOverview = (): Promise<Overview> => Promise.resolve({ live: false, reason: "no-token" });
