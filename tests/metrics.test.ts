import { describe, it, expect } from "vitest";
import { computeTrade, summarize, equityCurve, maxDrawdown, wilson, strength, median } from "@/domain/metrics";

describe("computeTrade: R multiple", () => {
  it("long: risk = entry − stop, R = net P&L ÷ risk $", () => {
    // EURUSD long 1.08250, SL 1.08150 (10 pips), exit 1.08450 (+20 pips), 1 lot ≈ $10/pip
    const d = computeTrade({ direction: "long", entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0845, exitPrice: 1.0845, grossPnl: 200, commission: -7, swap: 0, riskAmount: 100 });
    expect(d.riskPerUnit).toBeCloseTo(0.001, 10);
    expect(d.plannedRr).toBeCloseTo(2, 10);
    expect(d.netPnl).toBeCloseTo(193, 10);
    expect(d.rMultiple).toBeCloseTo(1.93, 10);
    expect(d.rBasis).toBe("money");
  });

  it("short: risk = stop − entry", () => {
    const d = computeTrade({ direction: "short", entryPrice: 150.0, initialStop: 150.5, exitPrice: 149.0, grossPnl: 666.67, riskAmount: 333.33 });
    expect(d.riskPerUnit).toBeCloseTo(0.5, 10);
    expect(d.rMultiple).toBeCloseTo(2.0, 3);
  });

  it("losing short at the stop is −1R (before costs) and costs push it below −1R", () => {
    const d = computeTrade({ direction: "short", entryPrice: 2000, initialStop: 2010, exitPrice: 2010, grossPnl: -100, commission: -5, swap: -2, riskAmount: 100 });
    expect(d.netPnl).toBeCloseTo(-107, 10);
    expect(d.rMultiple).toBeCloseTo(-1.07, 10);
  });

  it("infers risk $ from the trade's own P&L when not entered", () => {
    // moved +0.0020 for $200 gross → $100,000 per 1.0 price; risk 0.0010 → $100
    const d = computeTrade({ direction: "long", entryPrice: 1.1, initialStop: 1.099, exitPrice: 1.102, grossPnl: 200, commission: -10 });
    expect(d.riskAmount).toBeCloseTo(100, 6);
    expect(d.rMultiple).toBeCloseTo(1.9, 6);
  });

  it("falls back to price-based R when money is unknown", () => {
    const d = computeTrade({ direction: "long", entryPrice: 100, initialStop: 95, exitPrice: 110 });
    expect(d.rMultiple).toBeCloseTo(2, 10);
    expect(d.rBasis).toBe("price");
  });

  it("rejects a stop on the wrong side", () => {
    const d = computeTrade({ direction: "long", entryPrice: 100, initialStop: 105, exitPrice: 110 });
    expect(d.riskPerUnit).toBeNull();
    expect(d.rMultiple).toBeNull();
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("derives gross from net and computes % of balance", () => {
    const d = computeTrade({ direction: "long", entryPrice: 1, initialStop: 0.99, exitPrice: 1.02, netPnl: 190, commission: -10, riskAmount: 100, balanceAtEntry: 10_000 });
    expect(d.grossPnl).toBeCloseTo(200, 10);
    expect(d.riskPct).toBeCloseTo(1, 10);
    expect(d.pnlPct).toBeCloseTo(1.9, 10);
  });
});

const T = (netPnl: number, r: number | null, day: number) => ({ netPnl, rMultiple: r, openedAt: day, closedAt: day + 1 });

describe("summarize", () => {
  const trades = [T(200, 2, 1), T(-100, -1, 2), T(0, 0, 3), T(300, 3, 4), T(-100, -1, 5), T(-50, -0.5, 6)];
  const s = summarize(trades);

  it("win rate excludes breakevens", () => {
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(3);
    expect(s.breakevens).toBe(1);
    expect(s.winRate).toBeCloseTo(2 / 5, 10);
  });
  it("profit factor = gross profit ÷ |gross loss|", () => {
    expect(s.grossProfit).toBe(500);
    expect(s.grossLoss).toBe(-250);
    expect(s.profitFactor).toBeCloseTo(2, 10);
  });
  it("expectancy and R stats", () => {
    expect(s.netPnl).toBe(250);
    expect(s.expectancy).toBeCloseTo(250 / 6, 10);
    expect(s.avgR).toBeCloseTo(2.5 / 6, 10);
    expect(s.medianR).toBeCloseTo(-0.25, 10);
    expect(s.avgWinner).toBe(250);
    expect(s.avgLoser).toBeCloseTo(-250 / 3, 10);
  });
  it("streaks ignore breakevens", () => {
    expect(s.bestWinStreak).toBe(1);
    expect(s.worstLossStreak).toBe(2);
    expect(s.currentStreak).toEqual({ kind: "loss", length: 2 });
  });
  it("profit factor with no losers is Infinity, with no trades null", () => {
    expect(summarize([T(10, 1, 1)]).profitFactor).toBe(Infinity);
    expect(summarize([]).profitFactor).toBeNull();
    expect(summarize([]).winRate).toBeNull();
  });
  it("sorts by close time before computing streaks", () => {
    const s2 = summarize([T(-1, -1, 3), T(1, 1, 1), T(-1, -1, 2)]);
    expect(s2.currentStreak).toEqual({ kind: "loss", length: 2 });
  });
});

describe("equity curve & drawdown", () => {
  it("tracks high-water mark and max drawdown in $, % and R", () => {
    const curve = equityCurve([T(1000, 2, 1), T(-500, -1, 2), T(-700, -1.4, 3), T(2000, 4, 4)], 10_000);
    expect(curve.map((p) => p.balance)).toEqual([11000, 10500, 9800, 11800]);
    expect(curve.map((p) => p.hwm)).toEqual([11000, 11000, 11000, 11800]);
    const dd = maxDrawdown(curve);
    expect(dd.amount).toBe(1200);
    expect(dd.pct).toBeCloseTo((1200 / 11000) * 100, 10);
    expect(dd.r).toBeCloseTo(2.4, 10);
    expect(curve.at(-1)!.returnPct).toBeCloseTo(18, 10);
  });
  it("drawdown from the starting balance counts", () => {
    const dd = maxDrawdown(equityCurve([T(-300, -1, 1), T(100, 0.3, 2)], 1000));
    expect(dd.amount).toBe(300);
    expect(dd.pct).toBeCloseTo(30, 10);
  });
});

describe("statistics", () => {
  it("wilson interval contains the point estimate", () => {
    const ci = wilson(60, 100);
    expect(ci.low).toBeLessThan(0.6);
    expect(ci.high).toBeGreaterThan(0.6);
    expect(ci.low).toBeCloseTo(0.502, 2);
  });
  it("strength requires sample size", () => {
    expect(strength([1, 2, 3], 0)).toBe("insufficient");
    expect(strength(Array(15).fill(1), 0)).toBe("weak");
    const big = Array.from({ length: 120 }, (_, i) => (i % 2 ? 1.5 : 0.5));
    expect(strength(big, 0)).toBe("strong");
    const noisy = Array.from({ length: 40 }, (_, i) => (i % 2 ? 3 : -3));
    expect(strength(noisy, 0)).toBe("weak");
  });
  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
