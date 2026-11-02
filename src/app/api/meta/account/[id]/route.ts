import { explain, getAccountDetails, metaConfigured } from "@/lib/meta";

/* GET /api/meta/account/<ad account id, digits only>
   { status: { [campaign | ad set | ad id]: effective_status }, thumbs: { [ad id]: image URL } }
   The dashboard asks once, the first time an account row is opened. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,30}$/.test(id)) return Response.json({ error: "The ad account id must be digits" }, { status: 400 });
  if (!metaConfigured()) return Response.json({ error: "Meta is not connected" }, { status: 404 });
  try {
    return Response.json(await getAccountDetails(id));
  } catch (e) {
    console.error(`[meta] account ${id}:`, e instanceof Error ? e.message : e);
    return Response.json({ error: explain(e) }, { status: 502 });
  }
}
