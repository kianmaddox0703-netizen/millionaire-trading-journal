import { meanInterval } from "./metrics";

export interface Verdict { tone: "profit" | "loss" | "warn" | "neutral"; label: string; detail: string }

/**
 * "Does this work for me?" from the trades' R multiples.
 * Uses the 95% interval of mean R against zero; never declares an edge below 20 trades.
 */
export function strategyVerdict(rs: number[]): Verdict {
  const n = rs.length;
  if (n < 20) return { tone: "neutral", label: "Not enough trades", detail: `${n} trades with R. At least 20 are needed before judging; 50+ is better.` };
  const ci = meanInterval(rs)!;
  const range = `95% range of average R: ${ci.low.toFixed(2)}R to ${ci.high.toFixed(2)}R`;
  if (ci.low > 0) return { tone: "profit", label: "Working for you", detail: `Positive expectancy that is unlikely to be noise. ${range}.` };
  if (ci.high < 0) return { tone: "loss", label: "Losing for you", detail: `Negative expectancy that is unlikely to be noise. ${range}.` };
  const m = rs.reduce((a, b) => a + b, 0) / n;
  return { tone: "warn", label: m >= 0 ? "Leaning positive, inconclusive" : "Leaning negative, inconclusive", detail: `Average R can't yet be distinguished from zero. ${range}.` };
}
