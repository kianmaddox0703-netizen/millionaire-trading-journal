import { z } from "zod";

const optNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().finite().nullable());
const optPosNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().finite().positive().nullable());
const optStr = (max = 200) => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().trim().max(max).nullable());
const longText = z.preprocess((v) => (v ?? ""), z.string().max(20_000));
const bool = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
const optBool = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v === true || v === "on" || v === "true" || v === "yes"), z.boolean().nullable());
const scale = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(1).max(10).nullable());
const date = z.preprocess((v) => (v instanceof Date ? v : typeof v === "string" && v ? new Date(v) : v === "" ? null : v), z.date().nullable());

export const tradeInput = z
  .object({
    accountId: z.string().min(1, "Account is required"),
    strategyId: optStr(),
    setupId: optStr(),
    symbol: z.string().trim().min(1, "Symbol is required").max(30).transform((s) => s.toUpperCase().replace(/[^A-Z0-9.!_-]/g, "")),
    direction: z.enum(["long", "short"]),
    status: z.enum(["open", "closed"]).default("closed"),
    openedAt: date.refine((d) => d !== null, "Open time is required"),
    closedAt: date,
    entryPrice: z.preprocess((v) => Number(v), z.number().finite().positive("Entry must be > 0")),
    initialStop: optPosNum,
    takeProfit: optPosNum,
    exitPrice: optPosNum,
    sizeLots: optPosNum,
    riskAmount: optPosNum,
    grossPnl: optNum,
    netPnl: optNum,
    commission: optNum,
    swap: optNum,
    fees: optNum,
    session: optStr(40),
    timeframe: optStr(10),
    marketCondition: optStr(40),
    trend: optStr(20),
    htfBias: optStr(20),
    setupQuality: z.preprocess((v) => (v === "" ? null : v), z.enum(["A+", "A", "B", "C"]).nullable()).default(null),
    entryConfirmation: optStr(200),
    confluences: z.preprocess((v) => (v ?? ""), z.string().max(500)),
    chartUrl: z.preprocess((v) => (v === "" ? null : v), z.string().url().max(500).nullable()).default(null),
    notes: z
      .object({ why: longText, observed: longText, thesis: longText, whatHappened: longText, didWell: longText, didPoorly: longText, wouldChange: longText, lesson: longText })
      .partial()
      .default({}),
    psych: z
      .object({
        confidence: scale, discipline: scale, followedPlan: optBool,
        fomo: bool, revenge: bool, movedStop: bool, exitedEarly: bool, overtraded: bool, lateEntry: bool, oversized: bool,
      })
      .partial()
      .default({}),
    emotions: z
      .object({ before: optStr(30), during: optStr(30), after: optStr(30), beforeIntensity: scale, duringIntensity: scale, afterIntensity: scale })
      .partial()
      .default({}),
    mistakes: z.array(z.string().max(40)).default([]),
    factors: z.record(z.string().max(40), z.number().int().min(0).max(2).nullable()).default({}),
    checklist: z.array(z.object({ phase: z.enum(["pre", "post"]), item: z.string().max(300), checked: z.boolean().nullable(), answer: z.string().max(5000).nullable() })).default([]),
  })
  .superRefine((t, ctx) => {
    if (t.status === "closed") {
      if (!t.closedAt) ctx.addIssue({ code: "custom", path: ["closedAt"], message: "Close time is required for a closed trade" });
      if (t.exitPrice === null && t.netPnl === null && t.grossPnl === null)
        ctx.addIssue({ code: "custom", path: ["exitPrice"], message: "Exit price or P&L is required for a closed trade" });
    }
    if (t.closedAt && t.openedAt && t.closedAt < t.openedAt) ctx.addIssue({ code: "custom", path: ["closedAt"], message: "Close time is before open time" });
  });

export type TradeInput = z.infer<typeof tradeInput>;

export const riskRulesInput = z.object({
  maxRiskPct: optPosNum,
  maxDailyLossPct: optPosNum,
  maxWeeklyLossPct: optPosNum,
  maxTradesPerDay: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  maxConsecutiveLosses: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  minRr: optPosNum,
  tradingHoursStart: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{2}:\d{2}$/).nullable()),
  tradingHoursEnd: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{2}:\d{2}$/).nullable()),
  restrictedDays: z.preprocess((v) => (Array.isArray(v) ? v.join(",") : v ?? ""), z.string().regex(/^[0-6,]*$/)),
  requireChecklist: bool,
});
