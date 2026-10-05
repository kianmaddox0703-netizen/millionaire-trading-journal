import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { TradeFormValues } from "@/lib/tradeFormValues";

/** Date → "YYYY-MM-DDTHH:mm" in the given timezone, for <input type="datetime-local">. */
export function toLocalInput(d: Date | null, tz: string) {
  if (!d) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

export function tradeFormValues(userId: string, tradeId: string, tz: string): TradeFormValues | null {
  const t = db.query.trades.findFirst({
    where: and(eq(schema.trades.id, tradeId), eq(schema.trades.userId, userId)),
    with: { notes: true, psychology: true, emotions: true, mistakes: true, checklist: true, factors: true },
  }).sync();
  if (!t) return null;
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const em = (p: string) => t.emotions.find((e) => e.phase === p)?.emotion ?? "";
  const n = t.notes;
  const ps = t.psychology;
  return {
    accountId: t.accountId, strategyId: t.strategyId ?? "", setupId: t.setupId ?? "", symbol: t.symbol, direction: t.direction, status: t.status,
    openedAt: toLocalInput(t.openedAt, tz), closedAt: toLocalInput(t.closedAt, tz), entryPrice: s(t.entryPrice), initialStop: s(t.initialStop),
    takeProfit: s(t.takeProfit), exitPrice: s(t.exitPrice), sizeLots: s(t.sizeLots), riskAmount: s(t.riskAmount), netPnl: s(t.netPnl),
    commission: t.commission ? String(t.commission) : "", swap: t.swap ? String(t.swap) : "", fees: t.fees ? String(t.fees) : "",
    session: t.session ?? "", timeframe: t.timeframe ?? "", marketCondition: t.marketCondition ?? "", trend: t.trend ?? "", htfBias: t.htfBias ?? "",
    setupQuality: t.setupQuality ?? "", entryConfirmation: t.entryConfirmation ?? "", confluences: t.confluences, chartUrl: t.chartUrl ?? "",
    notes: n ? { why: n.why, observed: n.observed, thesis: n.thesis, whatHappened: n.whatHappened, didWell: n.didWell, didPoorly: n.didPoorly, wouldChange: n.wouldChange, lesson: n.lesson } : {},
    psych: {
      confidence: s(ps?.confidence), discipline: s(ps?.discipline), followedPlan: ps?.followedPlan === null || ps?.followedPlan === undefined ? "" : ps.followedPlan ? "yes" : "no",
      fomo: !!ps?.fomo, revenge: !!ps?.revenge, movedStop: !!ps?.movedStop, exitedEarly: !!ps?.exitedEarly, overtraded: !!ps?.overtraded, lateEntry: !!ps?.lateEntry, oversized: !!ps?.oversized,
    },
    emotions: { before: em("before"), during: em("during"), after: em("after") },
    mistakes: t.mistakes.filter((m) => m.source === "user").map((m) => m.mistakeKey),
    factors: Object.fromEntries(t.factors.map((f) => [f.factorKey, f.rating])),
    checklist: t.checklist.map((c) => ({ phase: c.phase, item: c.item, checked: c.checked, answer: c.answer })),
  };
}
