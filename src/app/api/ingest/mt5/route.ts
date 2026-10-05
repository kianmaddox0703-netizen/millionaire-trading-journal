import { NextResponse } from "next/server";
import { connectionForKey, ingestMt5, ingestSchema, MAX_INGEST_BYTES } from "@/server/mt5";

/** POST from bridge/mt5_bridge.py with `Authorization: Bearer mtj_…`. Read-only data in; never places trades. */
export async function POST(req: Request) {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const conn = connectionForKey(key);
  if (!conn) return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_INGEST_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_INGEST_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Body must be JSON" }, { status: 400 }); }
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  try {
    return NextResponse.json(ingestMt5(conn, parsed.data));
  } catch (e) {
    console.error("mt5 ingest failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: e instanceof Error && e.message === "Unknown server_time_zone" ? e.message : "Ingest failed" }, { status: 400 });
  }
}
