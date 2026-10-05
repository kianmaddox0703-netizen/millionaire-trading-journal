import { statFor, type GroupStat } from "./edge";
import { alignment, rrBucket, type InsightTrade } from "./insights";
import { summarize } from "./metrics";
import { MISTAKE_LABEL } from "./mistakes";

export interface ReviewTrade extends InsightTrade {
  openedAt: Date;
  closedAt: Date | null;
  riskPct: number | null;
  followedPlan: boolean | null;
  entryConfirmation?: string | null;
}

const TRAITS: [string, (t: ReviewTrade) => string | null][] = [
  ["Strategy", (t) => t.strategyName],
  ["Setup", (t) => t.setupName],
  ["Symbol", (t) => t.symbol],
  ["Session", (t) => t.session],
  ["Quality", (t) => t.setupQuality],
  ["Trend", (t) => alignment(t)],
  ["Target", (t) => rrBucket(t.plannedRr)],
  ["Timeframe", (t) => t.timeframe],
];

export interface Similarity {
  traits: { name: string; value: string }[];
  threshold: number;
  matches: ReviewTrade[];
  stat: GroupStat | null;
  baseline: { avgR: number | null; winRate: number | null };
}

/**
 * Historical comparison: trades (closed, before this one) sharing at least
 * `threshold` of this trade's known characteristics. Threshold is all-but-one
 * of the known traits, minimum 2, so matches are genuinely alike.
 */
export function similarTrades(t: ReviewTrade, history: ReviewTrade[]): Similarity {
  const traits = TRAITS.map(([name, f]) => ({ name, value: f(t) })).filter((x): x is { name: string; value: string } => !!x.value);
  const threshold = Math.max(2, traits.length - 1);
  const prior = history.filter((h) => h.id !== t.id && h.netPnl !== null && h.openedAt < t.openedAt);
  const matches = traits.length < 2 ? [] : prior.filter((h) => {
    let shared = 0;
    for (const tr of traits) if (TRAITS.find(([n]) => n === tr.name)![1](h) === tr.value) shared++;
    return shared >= threshold;
  });
  const base = summarize(prior.map((h) => ({ netPnl: h.netPnl, rMultiple: h.rMultiple, openedAt: h.openedAt, closedAt: h.closedAt })));
  return { traits, threshold, matches, stat: matches.length ? statFor("similar", matches, base.avgR) : null, baseline: { avgR: base.avgR, winRate: base.winRate } };
}

export interface TradeReview {
  well: string[];
  issues: string[];
  similarity: Similarity;
}

/** Deterministic, data-only review. Every statement comes from a field on the trade or the user's own history. */
export function reviewTrade(t: ReviewTrade, history: ReviewTrade[], rules: { maxRiskPct?: number | null; minRr?: number | null }): TradeReview {
  const well: string[] = [];
  const issues: string[] = [];
  const al = alignment(t);
  if (t.followedPlan === true) well.push("You recorded that you followed your plan.");
  if (t.followedPlan === false) issues.push("You recorded that you did not follow your plan.");
  if (t.strategyName) well.push(`Trade was tagged to a defined strategy (${t.strategyName}).`);
  if (al === "Trend aligned") well.push("Entry was aligned with the higher-timeframe bias.");
  if (al === "Countertrend") issues.push("Entry was against the higher-timeframe bias.");
  if (rules.maxRiskPct && t.riskPct !== null) {
    if (t.riskPct <= rules.maxRiskPct * 1.05) well.push(`Risk (${t.riskPct.toFixed(2)}%) stayed within your ${rules.maxRiskPct}% limit.`);
  }
  if (t.setupQuality === "A+" || t.setupQuality === "A") well.push(`Graded ${t.setupQuality} by you.`);
  for (const m of t.mistakes) issues.push(`${MISTAKE_LABEL[m] ?? m}.`);

  const similarity = similarTrades(t, history);
  const avgPlanned = summarizePlanned(history);
  if (t.plannedRr !== null && avgPlanned !== null && t.plannedRr < avgPlanned * 0.8)
    issues.push(`Planned R:R (1:${t.plannedRr.toFixed(2)}) is below your historical average (1:${avgPlanned.toFixed(2)}).`);
  if (t.netPnl !== null && t.plannedRr !== null && t.rMultiple !== null && t.netPnl > 0 && t.rMultiple < t.plannedRr * 0.6 && !t.mistakes.includes("early_exit"))
    issues.push(`Closed at ${t.rMultiple.toFixed(2)}R against a planned ${t.plannedRr.toFixed(2)}R. If this wasn't a rule-based exit, consider tagging it as an early exit.`);
  return { well, issues, similarity };
}

function summarizePlanned(history: ReviewTrade[]) {
  const xs = history.map((h) => h.plannedRr).filter((x): x is number => x !== null && x > 0);
  return xs.length >= 5 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
