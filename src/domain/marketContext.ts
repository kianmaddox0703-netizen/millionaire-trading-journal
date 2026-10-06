/**
 * Automatic market context at a trade's entry, computed from hourly candles. Pure and
 * deterministic, tested with constructed candle series in tests/marketdata.test.ts.
 *
 * These are the app's own definitions (CONTEXT_DEFINITIONS, shown in the UI), not FXAlexG's
 * rules and not a signal. NO LOOKAHEAD: only H1 candles that closed at or before the entry
 * are used, and 4-hour / daily candles still open at entry are dropped.
 */
import { z } from "zod";
import { median } from "./metrics";
import { sessionOf } from "./sessions";

export const CONTEXT_VERSION = 1;
export const LOOKBACK_DAYS = 40;
export const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const EMA_PERIOD = 50, SLOPE_BARS = 10, ATR_PERIOD = 14, FLAT_ATR = 0.25;
const VOL_WINDOW = 100, VOL_LOW = 0.75, VOL_HIGH = 1.33;
const LEVEL_ATR = 0.5, SWING_DAYS = 20;
export const MIN_H1 = EMA_PERIOD + SLOPE_BARS;

export const CONTEXT_DISCLAIMER = "These are this app's own fixed definitions, chosen to be simple and repeatable. They are not FXAlexG's rules and not a trading signal.";
export const CONTEXT_DEFINITIONS: [string, string][] = [
  ["Data", `One request per trade: hourly (H1) mid-price candles for the ${LOOKBACK_DAYS} days before entry. Only candles that had closed at or before the entry time are used, so nothing after the entry leaks in. 4-hour and daily candles are built from those hourly candles: days close at 17:00 New York (the usual FX day) and 4-hour candles start at 17:00, 21:00, 01:00, 05:00, 09:00 and 13:00 New York time. A 4-hour or daily candle still open at entry is left out.`],
  ["Trend (H1)", `Bullish when the last closed H1 close is above the ${EMA_PERIOD}-period EMA and that EMA rose by at least ${FLAT_ATR} × ATR${ATR_PERIOD} over the last ${SLOPE_BARS} candles; bearish is the mirror image; anything else is ranging. ATR${ATR_PERIOD} is Wilder's average true range.`],
  ["Higher-timeframe bias (H4)", `The same rule on 4-hour candles (EMA${EMA_PERIOD}, ${SLOPE_BARS}-candle slope, ${FLAT_ATR} × ATR${ATR_PERIOD} of H4): bullish, bearish or neutral.`],
  ["Volatility", `ATR${ATR_PERIOD} on H1 at entry divided by the median ATR${ATR_PERIOD} of the ${VOL_WINDOW} hourly candles before it: low below ${VOL_LOW}×, high above ${VOL_HIGH}×, otherwise normal.`],
  ["Near key level", `Yes when the entry price is within ${LEVEL_ATR} × ATR${ATR_PERIOD} (H1) of the previous New York day's high or low, or of a 4-hour swing high or low from the last ${SWING_DAYS} days. A swing high is a 4-hour candle whose high is above the two candles on each side (a swing low is the mirror image). Swings that a later 4-hour candle closed beyond are dropped as broken, so old overlapping swings don't make most entries count as near.`],
  ["Session", "From the entry time and each market's local business hours, the same rule as the trade's own session."],
];

export interface Candle { t: number; o: number; h: number; l: number; c: number; complete?: boolean } // t = candle start, ms UTC
export interface Bar extends Candle { end: number; n: number }

export type Trend = "bullish" | "bearish" | "ranging";
export type Bias = "bullish" | "bearish" | "neutral";
export type Volatility = "low" | "normal" | "high";
export const LEVEL_LABEL = { prev_day_high: "Previous day high", prev_day_low: "Previous day low", h4_swing_high: "H4 swing high", h4_swing_low: "H4 swing low" } as const;
export type LevelKind = keyof typeof LEVEL_LABEL;

// ───────────── indicators ─────────────

export function ema(xs: number[], period: number): (number | null)[] {
  const out: (number | null)[] = xs.map(() => null);
  if (xs.length < period) return out;
  let e = xs.slice(0, period).reduce((a, b) => a + b, 0) / period; // seeded with the SMA
  out[period - 1] = e;
  const k = 2 / (period + 1);
  for (let i = period; i < xs.length; i++) out[i] = e = xs[i] * k + e * (1 - k);
  return out;
}

/** Wilder's ATR: the first value is the mean true range of `period` candles, then smoothed. */
export function atr(bars: Candle[], period = ATR_PERIOD): (number | null)[] {
  const out: (number | null)[] = bars.map(() => null);
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  if (bars.length < period) return out;
  let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period;
  out[period - 1] = a;
  for (let i = period; i < bars.length; i++) out[i] = a = (a * (period - 1) + tr[i]) / period;
  return out;
}

// ───────────── resampling ─────────────

const NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** Trading day (closing at 17:00 New York) and hour within it (0 = 17:00 NY) of a timestamp. */
export function tradingClock(t: number) {
  const p = NY.formatToParts(new Date(t + 7 * HOUR));
  const get = (k: string) => p.find((x) => x.type === k)!.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/**
 * H1 → H4 (hours = 4) or D1 (hours = 24) aligned to the 17:00 New York close. Input sorted by time.
 * Each bar's end is its nominal close; on the two DST-switch Sundays a day is really 23/25 hours,
 * which only matters for instruments that trade at weekends.
 */
export function resample(h1: Candle[], hours: 4 | 24): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null, key = "";
  for (const c of h1) {
    const { day, hour } = tradingClock(c.t);
    const idx = Math.floor(hour / hours);
    const k = `${day}|${idx}`;
    if (cur && k === key) {
      cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.n++;
    } else {
      const start = c.t - (hour - idx * hours) * HOUR;
      out.push(cur = { t: start, end: start + hours * HOUR, o: c.o, h: c.h, l: c.l, c: c.c, n: 1 });
      key = k;
    }
  }
  return out;
}

// ───────────── readings ─────────────

export interface TrendReading { dir: "up" | "down" | "flat"; close: number; ema50: number; slope10: number; atr: number; bars: number }

export function trendReading(bars: Candle[]): TrendReading | null {
  if (bars.length < MIN_H1) return null;
  const i = bars.length - 1;
  const e = ema(bars.map((b) => b.c), EMA_PERIOD), a = atr(bars);
  const ema50 = e[i]!, slope10 = ema50 - e[i - SLOPE_BARS]!, atr14 = a[i]!, close = bars[i].c;
  const dir = close > ema50 && slope10 >= FLAT_ATR * atr14 ? "up" : close < ema50 && slope10 <= -FLAT_ATR * atr14 ? "down" : "flat";
  return { dir, close, ema50, slope10, atr: atr14, bars: bars.length };
}

export interface VolReading { value: Volatility; atr: number; medianAtr: number; ratio: number }

export function volatilityReading(h1: Candle[]): VolReading | null {
  const a = atr(h1), i = h1.length - 1;
  if (i - VOL_WINDOW < ATR_PERIOD - 1) return null;
  const now = a[i]!, med = median(a.slice(i - VOL_WINDOW, i) as number[]);
  if (med === null || !(med > 0)) return null;
  const ratio = now / med;
  return { value: ratio < VOL_LOW ? "low" : ratio > VOL_HIGH ? "high" : "normal", atr: now, medianAtr: med, ratio };
}

export interface Level { kind: LevelKind; price: number; at: number }

/** Unbroken 5-candle swing highs/lows among complete H4 bars that formed on or after `since`. */
export function swingLevels(h4: Bar[], since: number): Level[] {
  const out: Level[] = [];
  for (let j = 2; j < h4.length - 2; j++) {
    const b = h4[j];
    if (b.t < since) continue;
    const around = [h4[j - 2], h4[j - 1], h4[j + 1], h4[j + 2]];
    const later = h4.slice(j + 1);
    if (around.every((x) => b.h > x.h) && !later.some((x) => x.c > b.h)) out.push({ kind: "h4_swing_high", price: b.h, at: b.t });
    if (around.every((x) => b.l < x.l) && !later.some((x) => x.c < b.l)) out.push({ kind: "h4_swing_low", price: b.l, at: b.t });
  }
  return out;
}

export interface KeyLevelReading { near: boolean; tolerance: number; nearest: (Level & { distance: number; distanceAtr: number }) | null; levels: Level[] }

export function keyLevelReading(entry: number, atrH1: number, prevDay: Bar | null, swings: Level[]): KeyLevelReading | null {
  const levels: Level[] = [...(prevDay ? [{ kind: "prev_day_high" as const, price: prevDay.h, at: prevDay.t }, { kind: "prev_day_low" as const, price: prevDay.l, at: prevDay.t }] : []), ...swings];
  if (!levels.length || !(atrH1 > 0)) return null;
  const tolerance = LEVEL_ATR * atrH1;
  const best = levels.map((l) => ({ ...l, distance: Math.abs(entry - l.price) })).sort((a, b) => a.distance - b.distance)[0];
  const nearest = { ...best, distanceAtr: best.distance / atrH1 };
  return { near: nearest.distance <= tolerance, tolerance, nearest, levels };
}

// ───────────── context ─────────────

export const trendLabel = (r: TrendReading | null): Trend | null => (r ? (r.dir === "up" ? "bullish" : r.dir === "down" ? "bearish" : "ranging") : null);
export const biasLabel = (r: TrendReading | null): Bias | null => (r ? (r.dir === "up" ? "bullish" : r.dir === "down" ? "bearish" : "neutral") : null);

export interface ContextResult {
  trend: Trend | null;
  htfBias: Bias | null;
  volatility: Volatility | null;
  atr: number | null;
  nearKeyLevel: boolean | null;
  session: string;
  details: ContextComputation;
}

/** Only the H1 candles that had closed at or before `cutoff`, sorted and de-duplicated. */
export function closedH1(candles: Candle[], cutoff: number): Candle[] {
  const seen = new Set<number>();
  return candles
    .filter((c) => c.complete !== false && c.t + HOUR <= cutoff && [c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t)
    .filter((c) => !seen.has(c.t) && !!seen.add(c.t));
}

export function computeContext(candles: Candle[], openedAt: number, entryPrice: number): { ok: true; value: ContextResult } | { ok: false; reason: string } {
  const h1 = closedH1(candles, openedAt);
  if (h1.length < MIN_H1) return { ok: false, reason: `Only ${h1.length} hourly candles had closed before the entry; at least ${MIN_H1} are needed.` };
  const h4 = resample(h1, 4).filter((b) => b.end <= openedAt);
  const d1 = resample(h1, 24).filter((b) => b.end <= openedAt);
  const h1r = trendReading(h1), h4r = trendReading(h4), vol = volatilityReading(h1);
  const atrH1 = atr(h1).at(-1) ?? null;
  const prevDay = d1.at(-1) ?? null;
  const key = atrH1 !== null ? keyLevelReading(entryPrice, atrH1, prevDay, swingLevels(h4, openedAt - SWING_DAYS * DAY)) : null;
  const notes: string[] = [];
  if (!h4r) notes.push(`Higher-timeframe bias needs ${MIN_H1} complete 4-hour candles; only ${h4.length} were available.`);
  if (!vol) notes.push(`Volatility needs ${VOL_WINDOW + ATR_PERIOD} hourly candles; only ${h1.length} were available.`);
  if (!key) notes.push("No previous day or 4-hour swing level was available.");
  return {
    ok: true,
    value: {
      trend: trendLabel(h1r), htfBias: biasLabel(h4r), volatility: vol?.value ?? null, atr: atrH1, nearKeyLevel: key?.near ?? null,
      session: sessionOf(openedAt),
      details: {
        h1: h1r, h4: h4r, vol, key: key ? { ...key, levels: key.levels.slice(-20) } : null,
        prevDay: prevDay ? { t: prevDay.t, h: prevDay.h, l: prevDay.l } : null,
        candles: { h1: h1.length, h4: h4.length, d1: d1.length, from: h1[0].t, to: h1.at(-1)!.t + HOUR },
        notes,
      },
    },
  };
}

// ───────────── stored details ─────────────

const trendSchema = z.object({ dir: z.enum(["up", "down", "flat"]), close: z.number(), ema50: z.number(), slope10: z.number(), atr: z.number(), bars: z.number() }).nullable();
const levelSchema = z.object({ kind: z.enum(["prev_day_high", "prev_day_low", "h4_swing_high", "h4_swing_low"]), price: z.number(), at: z.number() });

const computationSchema = z.object({
  h1: trendSchema,
  h4: trendSchema,
  vol: z.object({ value: z.enum(["low", "normal", "high"]), atr: z.number(), medianAtr: z.number(), ratio: z.number() }).nullable(),
  key: z.object({ near: z.boolean(), tolerance: z.number(), nearest: levelSchema.extend({ distance: z.number(), distanceAtr: z.number() }).nullable(), levels: z.array(levelSchema) }).nullable(),
  prevDay: z.object({ t: z.number(), h: z.number(), l: z.number() }).nullable(),
  candles: z.object({ h1: z.number(), h4: z.number(), d1: z.number(), from: z.number(), to: z.number() }),
  notes: z.array(z.string()),
});
export type ContextComputation = z.infer<typeof computationSchema>;

/** What the context was computed from, so a later edit of the trade can be detected. */
const inputSchema = z.object({ symbol: z.string(), openedAt: z.string(), entryPrice: z.number() });
export type ContextInput = z.infer<typeof inputSchema>;

export const contextDetailsSchema = z.object({
  v: z.number(),
  input: inputSchema,
  computed: computationSchema.nullable(),
});
export type ContextDetails = z.infer<typeof contextDetailsSchema>;

export function parseContextDetails(json: string | null): ContextDetails | null {
  if (!json) return null;
  try {
    const r = contextDetailsSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const inputOf = (t: { symbol: string; openedAt: Date; entryPrice: number }): ContextInput => ({ symbol: t.symbol, openedAt: t.openedAt.toISOString(), entryPrice: t.entryPrice });
export const sameInput = (a: ContextInput, b: ContextInput) => a.symbol === b.symbol && a.openedAt === b.openedAt && a.entryPrice === b.entryPrice;

/** Trade direction relative to the automatic H4 bias. */
export function biasAlignment(direction: "long" | "short", bias: string | null) {
  if (bias !== "bullish" && bias !== "bearish" && bias !== "neutral") return null;
  if (bias === "neutral") return "Neutral HTF";
  return (bias === "bullish") === (direction === "long") ? "With HTF bias" : "Against HTF bias";
}
