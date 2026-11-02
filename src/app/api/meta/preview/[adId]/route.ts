import { explain, getPreview, metaConfigured } from "@/lib/meta";

/* GET /api/meta/preview/<ad id, digits only>
   { src, width, height }: Meta's signed mobile feed preview iframe for the ad.
   Fetched when the preview opens; the URL stops working after about a day. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ adId: string }> }) {
  const { adId } = await params;
  if (!/^\d{1,30}$/.test(adId)) return Response.json({ error: "The ad id must be digits" }, { status: 400 });
  if (!metaConfigured()) return Response.json({ error: "Meta is not connected" }, { status: 404 });
  try {
    return Response.json(await getPreview(adId));
  } catch (e) {
    console.error(`[meta] preview ${adId}:`, e instanceof Error ? e.message : e);
    return Response.json({ error: explain(e) }, { status: 502 });
  }
}
