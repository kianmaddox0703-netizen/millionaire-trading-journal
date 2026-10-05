import { and, eq } from "drizzle-orm";
import { getUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { readStored } from "@/server/storage";

/** Serves a trade image only to its owner. ?size=thumb for the WebP thumbnail. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const img = db.select().from(schema.tradeImages).where(and(eq(schema.tradeImages.id, id), eq(schema.tradeImages.userId, user.id))).get();
  if (!img) return new Response("Not found", { status: 404 });
  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  try {
    const buf = await readStored(thumb ? img.thumbKey : img.storageKey);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": thumb ? "image/webp" : img.mime,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("File missing", { status: 410 });
  }
}
