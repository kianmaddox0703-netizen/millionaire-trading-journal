import { dayOfWeek, weekStartOf, ymd } from "./sessions";

export const MISTAKES = [
  { key: "fomo", label: "FOMO", description: "Entered because of fear of missing the move rather than the plan." },
  { key: "revenge", label: "Revenge trading", description: "Trade taken to win back a recent loss." },
  { key: "overtrading", label: "Overtrading", description: "More trades than the plan or daily limit allows." },
  { key: "moved_stop", label: "Moved stop loss", description: "Stop widened or moved away after entry." },
  { key: "early_exit", label: "Took profit too early", description: "Closed before target without a rule-based reason." },
  { key: "late_entry", label: "Entered late", description: "Entry after the planned trigger, chasing price." },
  { key: "oversized", label: "Oversizing", description: "Risk above the configured max risk per trade." },
  { key: "outside_plan", label: "Trading outside plan", description: "Trade did not match a defined strategy." },
  { key: "restricted_time", label: "Restricted time", description: "Opened outside trading hours or on a restricted day." },
  { key: "low_quality", label: "Low-quality setup", description: "C-grade setup taken." },
  { key: "ignored_htf", label: "Ignored higher timeframe", description: "Trade against the higher-timeframe bias." },
  { key: "ignored_invalidation", label: "Ignored invalidation", description: "Held or entered after the setup was invalidated." },
  { key: "emotional", label: "Emotional trading", description: "Emotion drove the decision." },
  { key: "low_rr", label: "R:R below minimum", description: "Planned reward:risk below the configured minimum." },
  { key: "loss_limit", label: "Traded past loss limit", description: "Opened after hitting the daily loss or consecutive-loss limit." },
] as const;

export type MistakeKey = (typeof MISTAKES)[number]["key"];
export const MISTAKE_LABEL: Record<string, string> = Object.fromEntries(MISTAKES.map((m) => [m.key, m.label]));

export interface RiskRules {
  maxRiskPct?: number | null;
  maxDailyLossPct?: number | null;
  maxWeeklyLossPct?: number | null;
  maxTradesPerDay?: number | null;
  maxConsecutiveLosses?: number | null;
  minRr?: number | null;
  tradingHoursStart?: string | null;
  tradingHoursEnd?: string | null;
  restrictedDays?: string | null;
  requireChecklist?: boolean;
}

export interface DetectTrade {
  id: string;
  openedAt: Date;
  closedAt: Date | null;
  netPnl: number | null;
  rMultiple: number | null;
  riskPct: number | null;
  riskAmount: number | null;
  plannedRr: number | null;
  strategyId: string | null;
  setupQuality: string | null;
  direction: "long" | "short";
  htfBias: string | null;
  /** came from a file import or MT5 sync; the strategy is unknown rather than missing */
  imported?: boolean;
  psych?: { fomo?: boolean; revenge?: boolean; movedStop?: boolean; exitedEarly?: boolean; overtraded?: boolean; lateEntry?: boolean; oversized?: boolean } | null;
}

export interface Detected {
  key: MistakeKey;
  source: "user" | "rule";
  costR: number | null;
  note: string;
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Rule-based mistake detection. Deterministic and explainable: every detection
 * carries a note saying which rule fired. `history` is all of the user's trades
 * in the same account (any order), used for daily counts and loss streaks.
 *
 * Cost estimate for an early exit (opportunity, an upper bound): planned R − realised R,
 * only when the trade was closed in profit below its planned target.
 */
export function detectMistakes(t: DetectTrade, history: DetectTrade[], rules: RiskRules, balanceAtEntry: number | null, tz: string): Detected[] {
  const out: Detected[] = [];
  const add = (key: MistakeKey, source: Detected["source"], note: string, costR: number | null = null) => {
    if (!out.some((d) => d.key === key)) out.push({ key, source, costR, note });
  };
  const p = t.psych ?? {};

  if (p.fomo) add("fomo", "user", "You marked FOMO on this trade.");
  if (p.revenge) add("revenge", "user", "You marked this as a revenge trade.");
  if (p.movedStop) add("moved_stop", "user", "You marked that the stop was moved.");
  if (p.lateEntry) add("late_entry", "user", "You marked a late entry.");
  if (p.overtraded) add("overtrading", "user", "You marked this trade as overtrading.");
  if (p.oversized) add("oversized", "user", "You marked this trade as oversized.");
  if (p.exitedEarly) {
    const cost = t.plannedRr !== null && t.rMultiple !== null && t.rMultiple < t.plannedRr ? t.plannedRr - t.rMultiple : null;
    add("early_exit", "user", "You marked an early exit.", cost);
  }

  // Oversizing: risk % above max risk per trade (5% tolerance for rounding of lot sizes)
  if (rules.maxRiskPct && t.riskPct !== null && t.riskPct > rules.maxRiskPct * 1.05)
    add("oversized", "rule", `Risked ${t.riskPct.toFixed(2)}% vs max ${rules.maxRiskPct}%.`);

  if (rules.minRr && t.plannedRr !== null && t.plannedRr < rules.minRr)
    add("low_rr", "rule", `Planned R:R 1:${t.plannedRr.toFixed(2)} vs minimum 1:${rules.minRr}.`);

  // Imported trades start without a strategy because the broker doesn't know it, so that isn't a mistake.
  if (!t.strategyId && !t.imported) add("outside_plan", "rule", "No strategy assigned to this trade.");
  if (t.setupQuality === "C") add("low_quality", "rule", "Setup graded C.");

  if (t.htfBias && (t.htfBias === "bullish" || t.htfBias === "bearish")) {
    const against = (t.htfBias === "bullish" && t.direction === "short") || (t.htfBias === "bearish" && t.direction === "long");
    if (against) add("ignored_htf", "rule", `Trade direction ${t.direction} against ${t.htfBias} higher-timeframe bias.`);
  }

  // Restricted days / hours (in the user's timezone)
  const dow = dayOfWeek(t.openedAt, tz);
  const restricted = (rules.restrictedDays ?? "").split(",").filter(Boolean).map(Number);
  if (restricted.includes(dow)) add("restricted_time", "rule", "Opened on a restricted day.");
  if (rules.tradingHoursStart && rules.tradingHoursEnd) {
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(t.openedAt);
    const m = minutes(hm), s = minutes(rules.tradingHoursStart), e = minutes(rules.tradingHoursEnd);
    const inside = s <= e ? m >= s && m < e : m >= s || m < e;
    if (!inside) add("restricted_time", "rule", `Opened at ${hm}, outside trading hours ${rules.tradingHoursStart}–${rules.tradingHoursEnd}.`);
  }

  const day = ymd(t.openedAt, tz);
  const prior = history
    .filter((h) => h.id !== t.id && h.openedAt.getTime() < t.openedAt.getTime())
    .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const sameDayPrior = prior.filter((h) => ymd(h.openedAt, tz) === day);

  if (rules.maxTradesPerDay && sameDayPrior.length >= rules.maxTradesPerDay)
    add("overtrading", "rule", `Trade #${sameDayPrior.length + 1} of the day vs limit ${rules.maxTradesPerDay}.`);

  // Daily loss limit: closed losses earlier that day ≥ limit
  if (rules.maxDailyLossPct && balanceAtEntry) {
    const lost = prior.filter((h) => h.closedAt && h.closedAt <= t.openedAt && ymd(h.closedAt, tz) === day).reduce((a, h) => a + (h.netPnl ?? 0), 0); // net result so far today
    if (lost < 0 && -lost / balanceAtEntry * 100 >= rules.maxDailyLossPct)
      add("loss_limit", "rule", `Opened after losing ${((-lost / balanceAtEntry) * 100).toFixed(2)}% today (limit ${rules.maxDailyLossPct}%).`);
  }
  // Weekly loss limit (ISO week, user timezone)
  if (rules.maxWeeklyLossPct && balanceAtEntry) {
    const wk = weekStartOf(day);
    const lostW = prior.filter((h) => h.closedAt && h.closedAt <= t.openedAt && weekStartOf(ymd(h.closedAt, tz)) === wk).reduce((a, h) => a + (h.netPnl ?? 0), 0);
    if (lostW < 0 && (-lostW / balanceAtEntry) * 100 >= rules.maxWeeklyLossPct)
      add("loss_limit", "rule", `Opened after losing ${((-lostW / balanceAtEntry) * 100).toFixed(2)}% this week (limit ${rules.maxWeeklyLossPct}%).`);
  }
  // Consecutive losses
  if (rules.maxConsecutiveLosses) {
    let streak = 0;
    for (let i = prior.length - 1; i >= 0; i--) {
      const h = prior[i];
      if (!h.closedAt || h.closedAt > t.openedAt || h.netPnl === null) continue;
      if (h.netPnl < 0) streak++;
      else if (h.netPnl > 0) break;
    }
    if (streak >= rules.maxConsecutiveLosses) add("loss_limit", "rule", `Opened after ${streak} consecutive losses (limit ${rules.maxConsecutiveLosses}).`);
  }

  // Possible revenge: opened within 30 min of a losing close and with more risk than that loser
  const lastClosed = prior.filter((h) => h.closedAt && h.closedAt <= t.openedAt).sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime())[0];
  if (lastClosed && (lastClosed.netPnl ?? 0) < 0 && t.openedAt.getTime() - lastClosed.closedAt!.getTime() <= 30 * 60_000) {
    if (t.riskAmount !== null && lastClosed.riskAmount !== null && t.riskAmount > lastClosed.riskAmount * 1.2)
      add("revenge", "rule", "Opened within 30 minutes of a loss with larger risk than the losing trade.");
  }

  return out;
}
