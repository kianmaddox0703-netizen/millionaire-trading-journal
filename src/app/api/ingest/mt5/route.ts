import { NextResponse } from "next/server";
import { afterTradesSaved } from "@/server/hooks";
import { connectionForKey, ingestMt5, ingestSchema, MAX_INGEST_BYTES } from "@/server/mt5";
import { readText } from "@/server/http";

/** POST from bridge/mt5_bridge.py with `Authorization: Bearer mtj_…`. Read-only data in; never places trades. */
export async function POST(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const conn = connectionForKey(key);
  if (!conn) return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  const read = await readText(req, MAX_INGEST_BYTES);
  if (!read.ok) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const text = read.value;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  try {
    const { tradeIds, ...res } = ingestMt5(conn, parsed.data);
    afterTradesSaved(conn.userId, tradeIds, "mt5_bridge");
    return NextResponse.json(res);
  } catch (e) {
    console.error("mt5 ingest failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: e instanceof Error && e.message === "Unknown server_time_zone" ? e.message : "Ingest failed" }, { status: 400 });
  }
}
