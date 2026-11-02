import { CrmError, explain } from "@/lib/crm";
import type { CrmFail } from "@/lib/live";

/** a failed GHL read as the pages see it: why, in plain words */
export function crmFail(e: unknown): CrmFail {
  const code = e instanceof CrmError ? e.code : "";
  const reason = code === "not-connected" || code === "reinstall" || code === "config" ? code : "error";
  return { ok: false, reason, message: explain(e) };
}
