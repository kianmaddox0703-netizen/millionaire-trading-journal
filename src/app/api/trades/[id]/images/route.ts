import { NextResponse } from "next/server";
import { and, eq, max } from "drizzle-orm";
import { getUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { newId } from "@/server/ids";
import { MAX_IMAGE_BYTES, storeImage } from "@/server/storage";
import { readFormData } from "@/server/http";

const KINDS = ["before", "entry", "during", "exit", "tradingview", "mt5", "other"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const trade = db.select({ id: schema.trades.id }).from(schema.trades).where(and(eq(schema.trades.id, id), eq(schema.trades.userId, user.id))).get();
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  // capped while reading (1 MB allowance for multipart overhead)
  const read = await readFormData(req, MAX_IMAGE_BYTES + 1024 * 1024);
  if (!read.ok && read.tooLarge) return NextResponse.json({ error: "Image is larger than 15 MB" }, { status: 413 });
  const fd = read.ok ? read.value : null;
  const file = fd?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image is larger than 15 MB" }, { status: 413 });
  const kindRaw = String(fd?.get("kind") ?? "other");
  const kind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as (typeof KINDS)[number]) : "other";
  const caption = String(fd?.get("caption") ?? "").slice(0, 300);

  try {
    const stored = await storeImage(user.id, Buffer.from(await file.arrayBuffer()));
    const sort = (db.select({ m: max(schema.tradeImages.sort) }).from(schema.tradeImages).where(eq(schema.tradeImages.tradeId, id)).get()?.m ?? -1) + 1;
    const imageId = newId();
    db.insert(schema.tradeImages).values({ id: imageId, tradeId: id, userId: user.id, kind, caption, sort, ...stored }).run();
    return NextResponse.json({ id: imageId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
