/**
 * TradingView alert ↔ trade matching. Pure and unit-tested.
 *
 * An alert can belong to a trade when:
 *   symbol matches (after normalisation) and the alert's side, if any, equals the trade direction, and
 *   the trade opened between 10 minutes before and 4 hours after the alert.
 * Score (0–1):
 *   time  = 1 − Δ / 4h for trades after the alert; 1 − 0.5 × |Δ| / 10 min for trades just before it
 *   price = 1 − |entry − alert price| / entry ÷ 0.3%  (floored at 0)
 *   score = 0.6 × time + 0.4 × price, or 0.8 × time when the alert has no price
 * Scores ≥ 0.85 are linked automatically, 0.5–0.85 are suggested for the trader to confirm.
 */
import { normalizeSymbol } from "./importing";

export const MATCH_BEFORE_MS = 10 * 60_000;
export const MATCH_AFTER_MS = 4 * 3600_000;
export const AUTO_LINK = 0.85;
export const SUGGEST = 0.5;

export interface AlertLike { id: string; symbol: string | null; side: string | null; price: number | null; time: Date }
export interface TradeLike { id: string; symbol: string; direction: "long" | "short"; openedAt: Date; entryPrice: number }

export function alertSide(side: string | null): "long" | "short" | null {
  const s = (side ?? "").trim().toLowerCase();
  if (/^(buy|long|bull)/.test(s)) return "long";
  if (/^(sell|short|bear)/.test(s)) return "short";
  return null;
}

export function matchScore(a: AlertLike, t: TradeLike): number | null {
  if (!a.symbol || normalizeSymbol(a.symbol) !== normalizeSymbol(t.symbol)) return null;
  const side = alertSide(a.side);
  if (side && side !== t.direction) return null;
  const dt = t.openedAt.getTime() - a.time.getTime();
  if (dt < -MATCH_BEFORE_MS || dt > MATCH_AFTER_MS) return null;
  const time = dt >= 0 ? 1 - dt / MATCH_AFTER_MS : 1 - (0.5 * -dt) / MATCH_BEFORE_MS;
  if (a.price === null || !(a.price > 0)) return Math.round(0.8 * time * 1000) / 1000;
  const price = Math.max(0, 1 - Math.abs(t.entryPrice - a.price) / t.entryPrice / 0.003);
  return Math.round((0.6 * time + 0.4 * price) * 1000) / 1000;
}

/** Best trade for an alert, excluding pairs the trader rejected. */
export function bestTradeFor(a: AlertLike, trades: TradeLike[], rejected: Set<string> = new Set()): { trade: TradeLike; score: number } | null {
  let best: { trade: TradeLike; score: number } | null = null;
  for (const t of trades) {
    if (rejected.has(`${a.id}:${t.id}`)) continue;
    const s = matchScore(a, t);
    if (s !== null && s >= SUGGEST && (!best || s > best.score)) best = { trade: t, score: s };
  }
  return best;
}

// ───────────── alert payloads ─────────────

/**
 * Source: TradingView "About webhooks" help page. Alerts come only from these addresses, only to
 * ports 80/443, must be answered within 3 seconds, and are sent as application/json when the alert
 * message is valid JSON (text/plain otherwise). Webhooks need 2-factor authentication on the account.
 */
export const TRADINGVIEW_IPS = ["52.89.214.238", "34.212.75.30", "54.218.53.128", "52.32.178.7"];

/** Message to paste into a TradingView alert. {{…}} placeholders are filled in by TradingView. */
export const ALERT_TEMPLATE = `{
  "symbol": "{{ticker}}",
  "exchange": "{{exchange}}",
  "timeframe": "{{interval}}",
  "price": {{close}},
  "side": "long",
  "setup": "Pullback to AOI",
  "time": "{{timenow}}",
  "message": "4H trend up, retest of the AOI"
}`;

export interface ParsedAlert { symbol: string | null; timeframe: string | null; price: number | null; side: string | null; setup: string | null; alertTime: Date | null; message: string | null }

/** TradingView {{interval}} gives minutes ("15", "240") or "D"/"W"/"M"; shown as 15m, 4H, D… */
export function intervalLabel(v: string): string {
  if (/^\d+$/.test(v)) { const n = +v; return n % 60 === 0 ? `${n / 60}H` : `${n}m`; }
  const m = /^(\d*)([DWM])$/i.exec(v);
  return m ? `${m[1] && m[1] !== "1" ? m[1] : ""}${m[2].toUpperCase()}` : v;
}

export function parseAlertBody(body: string): ParsedAlert {
  const clip = (v: unknown, n = 200) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
  let o: Record<string, unknown> | null = null;
  try { const j = JSON.parse(body); if (j && typeof j === "object" && !Array.isArray(j)) o = j; } catch { /* plain text alert */ }
  if (!o) return { symbol: null, timeframe: null, price: null, side: null, setup: null, alertTime: null, message: clip(body, 2000) };
  const price = Number(o.price ?? o.close);
  const time = clip(o.time ?? o.timenow);
  const at = time ? new Date(time) : null;
  const sym = clip(o.symbol ?? o.ticker, 40);
  const tf = clip(o.timeframe ?? o.interval ?? o.tf, 10);
  return {
    symbol: sym ? normalizeSymbol(sym) : null, timeframe: tf ? intervalLabel(tf) : null, price: Number.isFinite(price) && price > 0 ? price : null,
    side: clip(o.side ?? o.action ?? o.direction, 20), setup: clip(o.setup ?? o.strategy, 100),
    alertTime: at && !Number.isNaN(at.getTime()) ? at : null, message: clip(o.message ?? o.comment ?? o.text, 2000),
  };
}
