import { summarize, type Summary } from "./metrics";
import { groupStats, type GroupStat } from "./edge";
import { mistakeInsights, type InsightTrade } from "./insights";
import { MISTAKE_LABEL } from "./mistakes";

export interface PeriodTrade extends InsightTrade {
  openedAt: Date;
  closedAt: Date | null;
  riskPct: number | null;
  followedPlan: boolean | null;
  emotionDuring: string | null;
  emotionAfter: string | null;
}

export interface PeriodReport {
  summary: Summary;
  best: { strategy: GroupStat | null; setup: GroupStat | null; symbol: GroupStat | null; session: GroupStat | null };
  worst: { strategy: GroupStat | null; setup: GroupStat | null; symbol: GroupStat | null; session: GroupStat | null };
  mistakes: { key: string; label: string; count: number; costR: number }[];
  emotions: { emotion: string; count: number }[];
  followedPlanPct: number | null;
  avgRiskPct: number | null;
  maxRiskPct: number | null;
  tradingDays: number;
  maxTradesInDay: number;
  findings: string[];
}

const top = (gs: GroupStat[], min: number, dir: 1 | -1) => {
  const xs = gs.filter((g) => g.n >= min && g.avgR !== null).sort((a, b) => dir * ((b.avgR ?? 0) - (a.avgR ?? 0)));
  return xs[0] ?? null;
};

/** Facts for a review period. Every finding sentence is computed from these numbers. */
export function periodReport(trades: PeriodTrade[], prev: PeriodTrade[] = []): PeriodReport {
  const closed = trades.filter((t) => t.netPnl !== null);
  const s = summarize(closed);
  const g = (f: (t: PeriodTrade) => string | null) => groupStats(closed, f, s.avgR);
  const min = closed.length >= 20 ? 3 : 2;
  const groups = { strategy: g((t) => t.strategyName), setup: g((t) => t.setupName), symbol: g((t) => t.symbol), session: g((t) => t.session) };
  const best = { strategy: top(groups.strategy, min, 1), setup: top(groups.setup, min, 1), symbol: top(groups.symbol, min, 1), session: top(groups.session, min, 1) };
  const worst = { strategy: top(groups.strategy, min, -1), setup: top(groups.setup, min, -1), symbol: top(groups.symbol, min, -1), session: top(groups.session, min, -1) };
  const mistakes = mistakeInsights(closed, s.avgR).map((m) => ({ key: m.key, label: m.label, count: m.count, costR: m.costR }));
  const emo = new Map<string, number>();
  for (const t of closed) for (const e of [t.emotionBefore, t.emotionDuring, t.emotionAfter]) if (e) emo.set(e, (emo.get(e) ?? 0) + 1);
  const emotions = [...emo.entries()].map(([emotion, count]) => ({ emotion, count })).sort((a, b) => b.count - a.count);
  const fp = closed.filter((t) => t.followedPlan !== null);
  const risks = closed.map((t) => t.riskPct).filter((x): x is number => x !== null);
  const perDay = new Map<string, number>();
  for (const t of closed) perDay.set(t.day, (perDay.get(t.day) ?? 0) + 1);

  const findings: string[] = [];
  if (closed.length) {
    findings.push(`${closed.length} trades, ${(s.winRate !== null ? s.winRate * 100 : 0).toFixed(0)}% win rate, average ${s.avgR?.toFixed(2) ?? "—"}R, total ${s.totalR.toFixed(1)}R.`);
    if (best.setup && worst.setup && best.setup.key !== worst.setup.key)
      findings.push(`Best setup: ${best.setup.key} (${best.setup.avgR!.toFixed(2)}R avg, n=${best.setup.n}). Weakest: ${worst.setup.key} (${worst.setup.avgR!.toFixed(2)}R avg, n=${worst.setup.n}).`);
    if (mistakes[0]) findings.push(`Most frequent mistake: ${mistakes[0].label} (${mistakes[0].count}×, ${mistakes[0].costR.toFixed(1)}R realised on those trades).`);
    if (fp.length) findings.push(`You marked “followed plan” on ${Math.round((fp.filter((t) => t.followedPlan).length / fp.length) * 100)}% of trades where you answered.`);
    const withM = closed.filter((t) => t.mistakes.length), clean = closed.filter((t) => !t.mistakes.length);
    const ws = summarize(withM), cs = summarize(clean);
    if (withM.length >= 3 && clean.length >= 3 && ws.avgR !== null && cs.avgR !== null)
      findings.push(`Trades with a recorded mistake averaged ${ws.avgR.toFixed(2)}R (n=${withM.length}) vs ${cs.avgR.toFixed(2)}R without (n=${clean.length}).`);
    if (prev.length) {
      const ps = summarize(prev.filter((t) => t.netPnl !== null));
      if (ps.avgR !== null && s.avgR !== null) findings.push(`Previous period: ${ps.count} trades at ${ps.avgR.toFixed(2)}R avg; this period ${s.avgR >= ps.avgR ? "improved" : "declined"} by ${Math.abs(s.avgR - ps.avgR).toFixed(2)}R per trade.`);
      const pm = mistakeInsights(prev.filter((t) => t.netPnl !== null), null);
      const improved = pm.map((m) => ({ ...m, now: mistakes.find((x) => x.key === m.key)?.count ?? 0 })).filter((m) => m.now < m.count).sort((a, b) => (b.count - b.now) - (a.count - a.now))[0];
      if (improved) findings.push(`Biggest improvement: ${MISTAKE_LABEL[improved.key] ?? improved.key} down from ${improved.count} to ${improved.now}.`);
    }
    if (closed.length < 10) findings.push(`Small sample (${closed.length} trades): treat these as observations, not patterns.`);
  }

  return {
    summary: s, best, worst, mistakes, emotions,
    followedPlanPct: fp.length ? fp.filter((t) => t.followedPlan).length / fp.length : null,
    avgRiskPct: risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : null,
    maxRiskPct: risks.length ? Math.max(...risks) : null,
    tradingDays: perDay.size,
    maxTradesInDay: Math.max(0, ...perDay.values()),
    findings,
  };
}
