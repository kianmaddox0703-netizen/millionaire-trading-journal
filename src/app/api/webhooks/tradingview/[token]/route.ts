import { NextResponse } from "next/server";
import { MAX_ALERT_BYTES, receiveAlert, userForWebhookToken } from "@/server/tradingview";
import { TRADINGVIEW_IPS } from "@/domain/matching";
import { readText } from "@/server/http";

// Simple per-user limiter (keyed after the token is verified, so random URLs can't grow it). TradingView itself caps alerts at roughly 15 per 3 minutes.
const hits = new Map<string, number[]>();
function limited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > 30;
}

/**
 * TradingView alert webhook. The URL token identifies the user (TradingView can't send auth headers).
 * Optional: TRADINGVIEW_IP_ALLOWLIST=true accepts only TradingView's published IPs; enable it only
 * behind a proxy that sets X-Forwarded-For reliably.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  if (process.env.TRADINGVIEW_IP_ALLOWLIST === "true") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (!TRADINGVIEW_IPS.includes(ip)) return new NextResponse("Forbidden", { status: 403 });
  }
  const userId = userForWebhookToken(token);
  if (!userId) return new NextResponse("Not found", { status: 404 });
  if (limited(userId)) return new NextResponse("Too many alerts", { status: 429 });
  const read = await readText(req, MAX_ALERT_BYTES);
  if (!read.ok) return new NextResponse("Too large", { status: 413 });
  receiveAlert(userId, read.value);
  return new NextResponse("ok", { status: 200 });
}
