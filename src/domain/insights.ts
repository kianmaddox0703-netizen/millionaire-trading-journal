import { findEdges, statFor, type GroupStat } from "./edge";
import { summarize } from "./metrics";
import { MISTAKE_LABEL } from "./mistakes";
import { DAYS } from "./sessions";

export interface InsightTrade {
  id: string;
  netPnl: number | null;
  rMultiple: number | null;
  symbol: string;
  session: string | null;
  timeframe: string | null;
  strategyName: string | null;
  setupName: string | null;
  setupQuality: string | null;
  direction: "long" | "short";
  htfBias: string | null;
  plannedRr: number | null;
  setupScore?: number | null;
  confluences: string[];
  mistakes: string[];
  mistakeCosts: Record<string, number | null>;
  dow: number;
  day: string;
  emotionBefore: string | null;

}

export function alignment(t: Pick<InsightTrade, "direction" | "htfBias">) {
  if (t.htfBias !== "bullish" && t.htfBias !== "bearish") return null;
  return (t.htfBias === "bullish") === (t.direction === "long") ? "Trend aligned" : "Countertrend";
}

export const rrBucket = (rr: number | null) => (rr === null ? null : rr >= 3 ? "3R+ target" : rr >= 2 ? "2–3R target" : "<2R target");

/** Dimensions the edge finder slices by. Values are human-readable so findings read naturally. */
export const EDGE_DIMS: Record<string, (t: InsightTrade) => string | null> = {
  Symbol: (t) => t.symbol,
  Session: (t) => t.session,
  Timeframe: (t) => t.timeframe,
  Strategy: (t) => t.strategyName,
  Setup: (t) => t.setupName,
  Quality: (t) => (t.setupQuality ? `${t.setupQuality} setup` : null),
  Trend: alignment,
  Target: (t) => rrBucket(t.plannedRr),
  Day: (t) => DAYS[t.dow],
  Score: (t) => (t.setupScore === null || t.setupScore === undefined ? null : t.setupScore >= 8 ? "Score 8–10" : t.setupScore >= 6 ? "Score 6–8" : "Score <6"),
  Emotion: (t) => (t.emotionBefore ? `Felt ${t.emotionBefore}` : null),
};

export function personalEdges(trades: InsightTrade[], minN = 5) {
  const closed = trades.filter((t) => t.netPnl !== null);
  const base = summarize(closed.map((t) => ({ ...t, openedAt: 0, closedAt: 0 }))).avgR;
  const { strongest, weakest } = findEdges(closed, EDGE_DIMS, base, minN);
  return {
    baselineAvgR: base,
    strongest: strongest.filter((c) => (c.stat.avgR ?? 0) > (base ?? 0)).slice(0, 6),
    weakest: weakest.filter((c) => (c.stat.avgR ?? 0) < (base ?? 0)).slice(0, 6),
  };
}

export interface MistakeInsight {
  key: string;
  label: string;
  count: number;
  costR: number; // realised R lost on trades with this mistake (sum of negative R)
  opportunityR: number; // estimated R left on the table (early exits)
  stat: GroupStat;
  mostCommon: { dim: string; value: string; share: number }[];
}

/**
 * Mistake ranking. Cost is reported two ways and never mixed:
 *  - realised: Σ R of losing trades that carried the mistake
 *  - opportunity (early exits only): Σ (planned R − realised R), an upper-bound estimate
 */
export function mistakeInsights(trades: InsightTrade[], baselineAvgR: number | null): MistakeInsight[] {
  const byKey = new Map<string, InsightTrade[]>();
  for (const t of trades) for (const k of t.mistakes) byKey.set(k, [...(byKey.get(k) ?? []), t]);
  const out: MistakeInsight[] = [];
  for (const [key, ts] of byKey) {
    const costR = ts.reduce((a, t) => a + Math.min(0, t.rMultiple ?? 0), 0);
    const opportunityR = ts.reduce((a, t) => a + (t.mistakeCosts[key] ?? 0), 0);
    const mostCommon: MistakeInsight["mostCommon"] = [];
    for (const [dim, fn] of Object.entries({ Session: EDGE_DIMS.Session, Symbol: EDGE_DIMS.Symbol, Outcome: (t: InsightTrade) => (t.netPnl === null ? null : t.netPnl > 0 ? "Winning trades" : "Losing trades"), Target: EDGE_DIMS.Target })) {
      const counts = new Map<string, number>();
      for (const t of ts) { const v = fn(t); if (v) counts.set(v, (counts.get(v) ?? 0) + 1); }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && ts.length >= 3) mostCommon.push({ dim, value: top[0], share: top[1] / ts.length });
    }
    out.push({ key, label: MISTAKE_LABEL[key] ?? key, count: ts.length, costR, opportunityR, stat: statFor(key, ts, baselineAvgR), mostCommon });
  }
  return out.sort((a, b) => b.count - a.count || a.costR - b.costR);
}

/** Bucketed comparison for a 1–10 scale (e.g. confidence) with sample sizes. */
export function scaleBuckets<T extends { id: string; netPnl: number | null; rMultiple: number | null }>(trades: T[], value: (t: T) => number | null, baselineAvgR: number | null) {
  const buckets = [
    { key: "Low (1–4)", test: (v: number) => v <= 4 },
    { key: "Mid (5–7)", test: (v: number) => v >= 5 && v <= 7 },
    { key: "High (8–10)", test: (v: number) => v >= 8 },
  ];
  return buckets.map((b) => statFor(b.key, trades.filter((t) => { const v = value(t); return t.netPnl !== null && v !== null && b.test(v); }), baselineAvgR));
}
