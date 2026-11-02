/* SERVER ONLY: what the Clients tab saves (business name, GHL account, booking
   calendars, status, removed), one database item per client, shared by everyone
   who opens the tracker. Input is checked field by field: anything unknown or
   malformed is dropped, so the page can't store more than these few fields. */

import { Conflict, getItem, listItems, putItem } from "./db";
import type { ClientSettings, Named, SettingsMap, SettingsPatch } from "./live";

const PK = "client";
const STATUSES = new Set(["active", "paused", "churned"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** a Meta ad account id ("act_123") or a dummy client id */
export const validId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

function named(v: unknown): Named | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const name = text(o.name, 200);
  return validId(o.id) && name !== undefined ? { id: o.id, name } : undefined;
}

/** the known, well-formed fields of a change; null (clear the field) is kept */
export function cleanPatch(p: unknown): SettingsPatch {
  if (!p || typeof p !== "object") return {};
  const o = p as Record<string, unknown>;
  const out: SettingsPatch = {};
  if (o.name === null) out.name = null;
  else if (typeof o.name === "string") out.name = text(o.name, 120);
  if (o.status === null) out.status = null;
  else if (typeof o.status === "string" && STATUSES.has(o.status)) out.status = o.status as ClientSettings["status"];
  if (o.ghl === null) out.ghl = null;
  else if (named(o.ghl)) out.ghl = named(o.ghl);
  if (o.calendars === null) out.calendars = null;
  else if (Array.isArray(o.calendars)) {
    const seen = new Set<string>();
    out.calendars = o.calendars
      .map(named)
      .filter((c): c is Named => !!c && !seen.has(c.id) && !!seen.add(c.id))
      .slice(0, 30);
  }
  if (o.removed === null) out.removed = null;
  else if (typeof o.removed === "boolean") out.removed = o.removed;
  return out;
}

function apply(cur: ClientSettings, patch: SettingsPatch): ClientSettings {
  const next: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  return next as ClientSettings;
}

export async function allSettings(): Promise<SettingsMap> {
  const out: SettingsMap = {};
  for (const it of await listItems<ClientSettings>(PK)) out[it.sk] = it.data;
  return out;
}

/** apply one change; a write that loses a race reads again and re-applies */
export async function patchSettings(id: string, patch: SettingsPatch): Promise<ClientSettings> {
  for (let attempt = 0; ; attempt++) {
    const cur = await getItem<ClientSettings>(PK, id);
    const next = apply(cur?.data ?? {}, patch);
    try {
      await putItem(PK, id, next, cur?.v ?? 0);
      return next;
    } catch (e) {
      if (!(e instanceof Conflict) || attempt >= 3) throw e;
    }
  }
}

/** copy a browser's saved edits up; clients that already have saved settings keep theirs */
export async function importSettings(map: unknown): Promise<SettingsMap> {
  if (map && typeof map === "object") {
    const entries = Object.entries(map as Record<string, unknown>).filter(([id]) => validId(id)).slice(0, 500);
    for (const [id, raw] of entries) {
      const s = apply({}, cleanPatch(raw));
      if (!Object.keys(s).length) continue;
      try {
        await putItem(PK, id, s, 0);
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
      }
    }
  }
  return allSettings();
}
