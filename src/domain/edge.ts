import { mean, median, strength, wilson, type Strength } from "./metrics";

export interface EdgeTrade {
  id: string;
  netPnl: number | null;
  rMultiple: number | null;

}

export interface GroupStat {
  key: string;
  n: number;
  wins: number;
  winRate: number | null;
  winRateCi: { low: number; high: number } | null;
  avgR: number | null;
  medianR: number | null;
  totalR: number;
  netPnl: number;
  expectancy: number | null;
  strength: Strength;
}

export function groupStats<T extends EdgeTrade>(
  trades: T[],
  keyOf: (t: T) => string | string[] | null | undefined,
  baselineAvgR: number | null,
): GroupStat[] {
  const groups = new Map<string, T[]>();
  for (const t of trades) {
    if (t.netPnl === null) continue;
    const k = keyOf(t);
    const keys = Array.isArray(k) ? k : k ? [k] : [];
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
  }
  return [...groups.entries()].map(([key, ts]) => statFor(key, ts, baselineAvgR)).sort((a, b) => b.netPnl - a.netPnl);
}

export function statFor(key: string, ts: EdgeTrade[], baselineAvgR: number | null): GroupStat {
  const pnls = ts.map((t) => t.netPnl as number);
  const wins = pnls.filter((p) => p > 0).length;
  const decided = pnls.filter((p) => p !== 0).length;
  const rs = ts.map((t) => t.rMultiple).filter((r): r is number => typeof r === "number");
  return {
    key,
    n: ts.length,
    wins,
    winRate: decided ? wins / decided : null,
    winRateCi: decided ? wilson(wins, decided) : null,
    avgR: mean(rs),
    medianR: median(rs),
    totalR: rs.reduce((a, b) => a + b, 0),
    netPnl: pnls.reduce((a, b) => a + b, 0),
    expectancy: mean(pnls),
    strength: strength(rs, baselineAvgR),
  };
}

export interface ConditionCombo {
  conditions: { dim: string; value: string }[];
  stat: GroupStat;
}

/**
 * Personal edge finder: evaluates every single condition and every pair of
 * conditions across the given dimensions, keeps groups with at least `minN`
 * trades, and ranks them by average R. Pairs are only kept when they beat
 * both of their single-condition parents, so the list isn't padded with
 * restatements of one strong factor.
 */
export function findEdges<T extends EdgeTrade>(
  trades: T[],
  dims: Record<string, (t: T) => string | null | undefined>,
  baselineAvgR: number | null,
  minN = 5,
) {
  const names = Object.keys(dims);
  const singles = new Map<string, ConditionCombo>();
  const combos: ConditionCombo[] = [];

  for (const dim of names) {
    for (const g of groupStats(trades, dims[dim], baselineAvgR)) {
      if (g.n < minN) continue;
      const c = { conditions: [{ dim, value: g.key }], stat: g };
      singles.set(`${dim}=${g.key}`, c);
      combos.push(c);
    }
  }
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const stats = groupStats(trades, (t) => {
        const va = dims[a](t), vb = dims[b](t);
        return va && vb ? `${va}\u0000${vb}` : null;
      }, baselineAvgR);
      for (const g of stats) {
        if (g.n < minN || g.avgR === null) continue;
        const [va, vb] = g.key.split("\u0000");
        const pa = singles.get(`${a}=${va}`)?.stat.avgR, pb = singles.get(`${b}=${vb}`)?.stat.avgR;
        const best = Math.max(pa ?? -Infinity, pb ?? -Infinity), worst = Math.min(pa ?? Infinity, pb ?? Infinity);
        if (g.avgR > best || g.avgR < worst) {
          combos.push({ conditions: [{ dim: a, value: va }, { dim: b, value: vb }], stat: { ...g, key: `${va} + ${vb}` } });
        }
      }
    }
  }
  // Rank by a shrunk average: small groups are pulled toward the baseline so a
  // lucky 5-trade group doesn't outrank a solid 60-trade one.
  //   shrunk = baseline + (avgR − baseline) × n ÷ (n + K),  K = 30 (a 30-trade group is pulled halfway)
  const b = baselineAvgR ?? 0;
  const shrunk = (s: GroupStat) => b + ((s.avgR ?? b) - b) * (s.n / (s.n + 30));
  const scored = combos.filter((c) => c.stat.avgR !== null);
  const strongest = [...scored].sort((x, y) => shrunk(y.stat) - shrunk(x.stat));
  const weakest = [...scored].sort((x, y) => shrunk(x.stat) - shrunk(y.stat));
  return { strongest, weakest };
}
