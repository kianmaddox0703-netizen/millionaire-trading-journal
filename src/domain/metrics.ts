/**
 * Trade metric formulas. Everything the app shows is computed here, so the
 * formulas are written out explicitly and covered by tests/metrics.test.ts.
 *
 * Conventions
 *  - direction sign: long = +1, short = −1
 *  - commission, swap and fees are signed the way brokers report them:
 *    a cost is negative, a credit (positive swap) is positive.
 *  - net P&L = gross P&L + commission + swap + fees
 *  - A trade is a WIN when net P&L > 0, a LOSS when < 0, BREAKEVEN when = 0.
 */

export type Direction = "long" | "short";

export const dirSign = (d: Direction) => (d === "long" ? 1 : -1);

export interface TradePriceInput {
  direction: Direction;
  entryPrice: number;
  initialStop?: number | null;
  takeProfit?: number | null;
  exitPrice?: number | null;
  grossPnl?: number | null; // account currency, before costs
  netPnl?: number | null; // account currency, after costs (if the user only knows this)
  commission?: number | null;
  swap?: number | null;
  fees?: number | null;
  riskAmount?: number | null; // account currency at the initial stop
  balanceAtEntry?: number | null;
}

export interface TradeDerived {
  /** Price distance between entry and initial stop, in the direction of risk. null if no valid stop. */
  riskPerUnit: number | null;
  /** Planned reward:risk to take profit, e.g. 3 means 1:3. */
  plannedRr: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  riskAmount: number | null;
  riskPct: number | null;
  pnlPct: number | null;
  /** R multiple = net P&L ÷ initial risk ($). Falls back to price-based R when $ figures are unknown. */
  rMultiple: number | null;
  rBasis: "money" | "price" | null;
  warnings: string[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function computeTrade(t: TradePriceInput): TradeDerived {
  const warnings: string[] = [];
  const s = dirSign(t.direction);
  const costs = (t.commission ?? 0) + (t.swap ?? 0) + (t.fees ?? 0);

  // Risk per unit of price.
  //   Long:  risk = entry − stop
  //   Short: risk = stop − entry
  // Equivalent: (entry − stop) × sign. Must be > 0, otherwise the "stop" is on the wrong side.
  let riskPerUnit: number | null = null;
  if (isNum(t.initialStop)) {
    const r = (t.entryPrice - t.initialStop) * s;
    if (r > 0) riskPerUnit = r;
    else warnings.push("Stop loss is on the wrong side of entry (or equal to it), so R cannot be computed from price.");
  }

  // Planned R:R to take profit = (tp − entry) × sign ÷ risk per unit
  let plannedRr: number | null = null;
  if (riskPerUnit && isNum(t.takeProfit)) {
    const reward = (t.takeProfit - t.entryPrice) * s;
    plannedRr = reward / riskPerUnit;
    if (reward <= 0) warnings.push("Take profit is on the wrong side of entry.");
  }

  // P&L. Prefer broker-reported gross; else derive gross from a known net.
  let grossPnl: number | null = isNum(t.grossPnl) ? t.grossPnl : null;
  let netPnl: number | null = null;
  if (grossPnl !== null) netPnl = grossPnl + costs;
  else if (isNum(t.netPnl)) {
    netPnl = t.netPnl;
    grossPnl = t.netPnl - costs;
  }

  // Risk in money.
  //   If entered: use it.
  //   Else infer from the trade itself: value per 1.0 of price movement
  //     v = gross P&L ÷ ((exit − entry) × sign)
  //   then risk $ = v × risk per unit. Exact for instruments whose P&L is linear in price.
  let riskAmount: number | null = isNum(t.riskAmount) && t.riskAmount > 0 ? t.riskAmount : null;
  if (riskAmount === null && riskPerUnit && grossPnl !== null && isNum(t.exitPrice)) {
    const move = (t.exitPrice - t.entryPrice) * s;
    if (Math.abs(move) > 0) {
      const valuePerPrice = grossPnl / move;
      if (valuePerPrice > 0) riskAmount = valuePerPrice * riskPerUnit;
    }
  }

  // R multiple
  //   Primary:  R = net P&L ÷ initial risk $        (includes commission, swap, fees)
  //   Fallback: R = (exit − entry) × sign ÷ risk per unit   (price-only, excludes costs)
  let rMultiple: number | null = null;
  let rBasis: TradeDerived["rBasis"] = null;
  if (netPnl !== null && riskAmount) {
    rMultiple = netPnl / riskAmount;
    rBasis = "money";
  } else if (riskPerUnit && isNum(t.exitPrice)) {
    rMultiple = ((t.exitPrice - t.entryPrice) * s) / riskPerUnit;
    rBasis = "price";
    if (costs !== 0) warnings.push("R is price-based and excludes costs because risk in money is unknown.");
  }

  const bal = isNum(t.balanceAtEntry) && t.balanceAtEntry > 0 ? t.balanceAtEntry : null;
  const riskPct = bal && riskAmount ? (riskAmount / bal) * 100 : null;
  const pnlPct = bal && netPnl !== null ? (netPnl / bal) * 100 : null;

  return { riskPerUnit, plannedRr, grossPnl, netPnl, riskAmount, riskPct, pnlPct, rMultiple, rBasis, warnings };
}

// ───────────── aggregate statistics ─────────────

export interface StatTrade {
  netPnl: number | null;
  rMultiple: number | null;
  closedAt: Date | number | null;
  openedAt: Date | number;
}

export interface Summary {
  count: number; // closed trades with known P&L
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null; // wins ÷ (wins + losses)
  netPnl: number;
  grossProfit: number; // Σ net P&L of winners
  grossLoss: number; // Σ net P&L of losers (negative)
  profitFactor: number | null; // grossProfit ÷ |grossLoss|
  expectancy: number | null; // mean net P&L per trade
  rCount: number;
  avgR: number | null; // mean R (this is expectancy in R)
  medianR: number | null;
  totalR: number;
  avgWinner: number | null;
  avgLoser: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  currentStreak: { kind: "win" | "loss" | "none"; length: number };
  bestWinStreak: number;
  worstLossStreak: number;
}

const tsOf = (d: Date | number | null) => (d === null ? 0 : typeof d === "number" ? d : d.getTime());
export const byClose = <T extends StatTrade>(a: T, b: T) =>
  tsOf(a.closedAt ?? a.openedAt) - tsOf(b.closedAt ?? b.openedAt);

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function summarize(input: StatTrade[]): Summary {
  const trades = input.filter((t) => t.netPnl !== null).sort(byClose);
  const pnls = trades.map((t) => t.netPnl as number);
  const winners = pnls.filter((p) => p > 0);
  const losers = pnls.filter((p) => p < 0);
  const rs = trades.map((t) => t.rMultiple).filter(isNum);
  const winRs = trades.filter((t) => (t.netPnl as number) > 0).map((t) => t.rMultiple).filter(isNum);
  const lossRs = trades.filter((t) => (t.netPnl as number) < 0).map((t) => t.rMultiple).filter(isNum);

  const grossProfit = winners.reduce((a, b) => a + b, 0);
  const grossLoss = losers.reduce((a, b) => a + b, 0);
  const decided = winners.length + losers.length;

  // Streaks (breakevens neither extend nor break a streak)
  let best = 0, worst = 0, run = 0, runKind: "win" | "loss" | "none" = "none";
  for (const p of pnls) {
    if (p === 0) continue;
    const k = p > 0 ? "win" : "loss";
    if (k === runKind) run++;
    else { runKind = k; run = 1; }
    if (k === "win") best = Math.max(best, run);
    else worst = Math.max(worst, run);
  }

  return {
    count: trades.length,
    wins: winners.length,
    losses: losers.length,
    breakevens: pnls.length - decided,
    winRate: decided ? winners.length / decided : null,
    netPnl: pnls.reduce((a, b) => a + b, 0),
    grossProfit,
    grossLoss,
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : null,
    expectancy: mean(pnls),
    rCount: rs.length,
    avgR: mean(rs),
    medianR: median(rs),
    totalR: rs.reduce((a, b) => a + b, 0),
    avgWinner: mean(winners),
    avgLoser: mean(losers),
    avgWinR: mean(winRs),
    avgLossR: mean(lossRs),
    largestWin: winners.length ? Math.max(...winners) : null,
    largestLoss: losers.length ? Math.min(...losers) : null,
    currentStreak: { kind: runKind, length: runKind === "none" ? 0 : run },
    bestWinStreak: best,
    worstLossStreak: worst,
  };
}

// ───────────── equity curve & drawdown ─────────────

export interface EquityPoint {
  t: number;
  balance: number;
  hwm: number; // high-water mark
  drawdown: number; // hwm − balance (≥ 0)
  drawdownPct: number; // drawdown ÷ hwm × 100
  returnPct: number; // (balance − start) ÷ start × 100
  cumR: number;
  rHwm: number;
  rDrawdown: number;
}

/**
 * Closed-trade equity curve.
 *   balance_i = start + Σ net P&L up to i
 *   hwm_i     = max(start, balance_0..i)
 *   drawdown  = hwm − balance
 * Max drawdown = max(drawdown_i); also tracked in R on the cumulative-R curve.
 */
export function equityCurve(input: StatTrade[], startingBalance: number): EquityPoint[] {
  const trades = input.filter((t) => t.netPnl !== null).sort(byClose);
  let bal = startingBalance, hwm = startingBalance, cumR = 0, rHwm = 0;
  const pts: EquityPoint[] = [];
  for (const t of trades) {
    bal += t.netPnl as number;
    cumR += isNum(t.rMultiple) ? t.rMultiple : 0;
    hwm = Math.max(hwm, bal);
    rHwm = Math.max(rHwm, cumR);
    pts.push({
      t: tsOf(t.closedAt ?? t.openedAt),
      balance: bal,
      hwm,
      drawdown: hwm - bal,
      drawdownPct: hwm > 0 ? ((hwm - bal) / hwm) * 100 : 0,
      returnPct: startingBalance > 0 ? ((bal - startingBalance) / startingBalance) * 100 : 0,
      cumR,
      rHwm,
      rDrawdown: rHwm - cumR,
    });
  }
  return pts;
}

export function maxDrawdown(curve: EquityPoint[]) {
  let dd = 0, ddPct = 0, ddR = 0;
  for (const p of curve) {
    dd = Math.max(dd, p.drawdown);
    ddPct = Math.max(ddPct, p.drawdownPct);
    ddR = Math.max(ddR, p.rDrawdown);
  }
  return { amount: dd, pct: ddPct, r: ddR };
}

// ───────────── statistical strength ─────────────

/** 95% Wilson score interval for a proportion. */
export function wilson(successes: number, n: number, z = 1.96) {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** 95% interval for the mean (normal approximation; fine for n ≥ 30, indicative below). */
export function meanInterval(xs: number[], z = 1.96) {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  const se = Math.sqrt(variance / xs.length);
  return { low: m - z * se, high: m + z * se };
}

export type Strength = "insufficient" | "weak" | "moderate" | "strong";

export const STRENGTH_LABEL: Record<Strength, string> = {
  insufficient: "Insufficient sample",
  weak: "Weak evidence",
  moderate: "Moderate evidence",
  strong: "Strong historical pattern",
};

/**
 * How much to trust a pattern vs. the baseline (all trades).
 *  n < 10                     → insufficient
 *  n < 30                     → weak
 *  interval of avg R excludes the baseline avg R:
 *    n ≥ 100 → strong, else moderate
 *  otherwise                  → weak (difference not distinguishable from noise)
 */
export function strength(rs: number[], baselineAvgR: number | null): Strength {
  const n = rs.length;
  if (n < 10) return "insufficient";
  if (n < 30) return "weak";
  const ci = meanInterval(rs);
  if (!ci || baselineAvgR === null) return "weak";
  const separated = ci.low > baselineAvgR || ci.high < baselineAvgR;
  if (!separated) return "weak";
  return n >= 100 ? "strong" : "moderate";
}
