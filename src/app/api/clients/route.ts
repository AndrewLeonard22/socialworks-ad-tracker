import { explainDb } from "@/lib/db";
import { allSettings, cleanPatch, importSettings, patchSettings, validId } from "@/lib/settings";

/* /api/clients: what the Clients tab saves, shared by everyone who opens the tracker.
   GET                                  { ok: true, settings: { [adAccountId]: settings } }
   PATCH { id, patch, auto? }           { ok: true, settings }   one client's change (null clears a field);
                                                                 auto: only while the client has no GHL account
   POST  { import: { [id]: settings } } { ok: true, settings }   one-time copy of a browser's old edits
   Failures answer { ok: false, message } with a 4xx/5xx status. */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (message: string, status: number) => Response.json({ ok: false, message }, { status });

async function body(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    return Response.json({ ok: true, settings: await allSettings() });
  } catch (e) {
    console.error("[clients] read:", e);
    return fail(explainDb(e), 503);
  }
}

export async function PATCH(req: Request) {
  const b = await body(req);
  if (!b || !validId(b.id)) return fail("Unknown client", 400);
  const patch = cleanPatch(b.patch);
  if (!Object.keys(patch).length) return fail("Nothing to save", 400);
  try {
    return Response.json({ ok: true, settings: await patchSettings(b.id, patch, b.auto === true) });
  } catch (e) {
    console.error("[clients] save:", e);
    return fail(explainDb(e), 503);
  }
}

export async function POST(req: Request) {
  const b = await body(req);
  if (!b || !b.import || typeof b.import !== "object") return fail("Nothing to import", 400);
  try {
    return Response.json({ ok: true, settings: await importSettings(b.import) });
  } catch (e) {
    console.error("[clients] import:", e);
    return fail(explainDb(e), 503);
  }
}
