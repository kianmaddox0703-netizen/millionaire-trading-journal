import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { applyFilter, loadTrades, userAccounts, type EnrichedTrade, type TradeFilter } from "../analytics";
import { getRiskRules } from "../trades";
import { equityCurve, maxDrawdown, STRENGTH_LABEL, summarize } from "@/domain/metrics";
import { groupStats, statFor, type GroupStat } from "@/domain/edge";
import { alignment, mistakeInsights, personalEdges, rrBucket, scaleBuckets } from "@/domain/insights";
import { reviewTrade, similarTrades } from "@/domain/review";
import { strategyVerdict } from "@/domain/verdict";
import { MISTAKES, MISTAKE_LABEL } from "@/domain/mistakes";
import { DAYS, SESSIONS, ymd } from "@/domain/sessions";
import { FXALEXG_KB } from "@/domain/kb/fxalexg";
import { ScreenshotAnalysis, againstCurrentRecord } from "@/domain/ai/screenshot";
import { scrubDeep } from "@/domain/ai/guard";
import { EMOTIONS } from "../db/schema";
import { contextFor, stateOf } from "../marketdata/context";

/**
 * The coach's data tools. Read-only, and every query is filtered by the signed-in user's id, so the
 * model can only ever see this trader's journal and can't change anything. Each tool calls the same
 * deterministic code the pages use and returns compact JSON with sample sizes and evidence labels.
 */

// ───────────── data access for one coach request ─────────────

export class CoachData {
  readonly accounts: ReturnType<typeof userAccounts>;
  readonly scopeAccountId: string | undefined;
  private all: EnrichedTrade[] | null = null;

  constructor(readonly userId: string, readonly tz: string, accountId?: string) {
    this.accounts = userAccounts(userId);
    this.scopeAccountId = accountId && this.accounts.some((a) => a.id === accountId) ? accountId : undefined;
  }

  /** Every trade of the user, including archived accounts (for lookups by number). */
  allTrades() {
    return (this.all ??= loadTrades(this.userId, this.tz));
  }
  /** Trades in active accounts, as the pages show them. */
  activeTrades() {
    return this.allTrades().filter((t) => this.accounts.some((a) => a.id === t.accountId));
  }
  /** Trades in the default scope (the account selected in the app, or all active accounts). */
  scoped() {
    const ts = this.activeTrades();
    return this.scopeAccountId ? ts.filter((t) => t.accountId === this.scopeAccountId) : ts;
  }
  scopeLabel() {
    const a = this.accounts.find((x) => x.id === this.scopeAccountId);
    return a ? `account "${a.name}" (selected in the app)` : "all active accounts";
  }
  bySeq(seq: number) {
    return this.allTrades().find((t) => t.seq === seq);
  }
}

class ToolInputError extends Error {}

// ───────────── formatting ─────────────

const r2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 1000) / 10);
const clip = (s: string | null | undefined, n = 600) => (!s ? null : s.length > n ? `${s.slice(0, n)}…` : s);

const empty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) ? !v.length : Object.getPrototypeOf(v) === Object.prototype && !Object.keys(v as object).length);

/** Drops null, undefined, empty strings, empty lists and empty objects so results stay small. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => !empty(v))) as Partial<T>;
}

function sampleNote(n: number) {
  if (n < 10) return "Insufficient sample (under 10 closed trades): describe it, draw no conclusion.";
  if (n < 30) return "Weak evidence (10-29 closed trades).";
  if (n < 100) return "Moderate sample (30-99 closed trades).";
  return "Large sample (100+ closed trades).";
}

function groupRow(g: GroupStat) {
  return compact({
    value: g.key, n: g.n, winRatePct: pct(g.winRate), winRate95Pct: g.winRateCi ? [pct(g.winRateCi.low), pct(g.winRateCi.high)] : null,
    avgR: r2(g.avgR), medianR: r2(g.medianR), totalR: r2(g.totalR), netPnl: r2(g.netPnl), evidence: STRENGTH_LABEL[g.strength],
  });
}

const fmtTime = (d: Date | null, tz: string) =>
  d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(",", "") : null;

function tradeRow(t: EnrichedTrade, multiAccount: boolean) {
  return compact({
    seq: t.seq, day: t.day, symbol: t.symbol, direction: t.direction, status: t.status, account: multiAccount ? t.accountName : null,
    strategy: t.strategyName, setup: t.setupName, quality: t.setupQuality, session: t.session, timeframe: t.timeframe,
    r: r2(t.rMultiple), netPnl: r2(t.netPnl), plannedRr: r2(t.plannedRr), mistakes: t.mistakes.map((k) => MISTAKE_LABEL[k] ?? k),
    emotionBefore: t.emotionBefore, followedPlan: t.followedPlan,
  });
}

/** Bounded copy of a stored JSON value: long strings and lists are cut so one row can't flood the context. */
function shrink(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return clip(v, 400);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (depth > 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 8).map((x) => shrink(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, shrink(x, depth + 1)]));
  return undefined;
}

function storedJson(output: string): unknown {
  try { return shrink(scrubDeep(JSON.parse(output)).value); } catch { return null; }
}

// ───────────── filters ─────────────

const FILTER_FIELDS = ["account", "from", "to", "symbol", "session", "strategy", "setup", "direction", "timeframe", "emotion", "quality", "mistake", "weekday", "status", "outcome", "text"] as const;

const Conditions = z.array(z.strictObject({
  field: z.enum(FILTER_FIELDS),
  value: z.string(),
})).describe(
  "Filters, all of which must match. Empty list = every trade in the default scope. Values: account = account name or \"all\"; " +
  "from / to = YYYY-MM-DD (inclusive, the trader's local day the trade closed); symbol e.g. EURUSD; session = Sydney, Tokyo, London, " +
  "London/NY overlap, New York or Off-hours; strategy / setup = name; direction = long or short; timeframe e.g. 15m, 1H, 4H; " +
  "emotion = emotion recorded before, during or after (calm, confident, fear, greed, fomo, frustration, revenge, boredom, hesitation, excitement, anxiety); " +
  "quality = A+, A, B or C; mistake = mistake name (e.g. Moved stop loss); weekday = Mon to Sun (day the trade opened); status = open or closed; " +
  "outcome = win or loss; text = free-text search over symbols, tags, mistakes and notes. Use each field at most once.",
);
type Condition = z.infer<typeof Conditions>[number];

const lower = (s: string) => s.trim().toLowerCase();
/** Case-insensitive match against allowed values; journal = the values come from the trader's own trades. */
function pick(field: string, value: string, options: readonly string[], journal = false) {
  const hit = options.find((o) => lower(o) === lower(value));
  if (hit) return hit;
  const list = options.slice(0, 40).join(", ") || "none recorded yet";
  throw new ToolInputError(journal ? `No trades with ${field} "${value}". Values in the journal: ${list}.` : `Unknown ${field} "${value}". Use one of: ${list}.`);
}
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();

/** Trades matching the conditions: the default scope, narrowed by TradeFilter/applyFilter and name filters. */
function select(d: CoachData, conditions: Condition[]) {
  const f: TradeFilter = {};
  const applied: string[] = [];
  const seen = new Set<string>();
  let account: string | undefined = d.scopeAccountId;
  let strategy: string | null = null, setup: string | null = null;
  const base = d.activeTrades();
  for (const c of conditions) {
    if (seen.has(c.field)) throw new ToolInputError(`Use each field once; "${c.field}" appears more than once.`);
    seen.add(c.field);
    const v = c.value.trim().slice(0, 100);
    if (!v) throw new ToolInputError(`The value for "${c.field}" is empty.`);
    switch (c.field) {
      case "account":
        if (lower(v) === "all") account = undefined;
        else account = d.accounts.find((a) => a.name === pick("account", v, d.accounts.map((x) => x.name), true))!.id;
        break;
      case "from": case "to":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ToolInputError(`"${c.field}" must be a date as YYYY-MM-DD.`);
        f[c.field] = v;
        break;
      case "symbol": f.symbol = pick("symbol", v.toUpperCase().replace(/[/\s]/g, ""), uniq(base.map((t) => t.symbol)), true); break;
      case "session": f.session = pick("session", v, SESSIONS); break;
      case "strategy": strategy = pick("strategy", v, uniq(base.map((t) => t.strategyName)), true); break;
      case "setup": setup = pick("setup", v, uniq(base.map((t) => t.setupName)), true); break;
      case "direction": f.direction = pick("direction", v, ["long", "short"]); break;
      case "timeframe": f.timeframe = pick("timeframe", v, uniq(base.map((t) => t.timeframe)), true); break;
      case "emotion": f.emotion = pick("emotion", v, EMOTIONS); break;
      case "quality": f.quality = pick("quality", v, ["A+", "A", "B", "C"]); break;
      case "mistake": {
        const m = MISTAKES.find((x) => lower(x.key) === lower(v) || lower(x.label) === lower(v));
        if (!m) throw new ToolInputError(`Unknown mistake "${v}". Known: ${MISTAKES.map((x) => x.label).join(", ")}.`);
        f.mistake = m.key;
        break;
      }
      case "weekday": {
        const i = DAYS.findIndex((x) => lower(v).startsWith(lower(x)));
        if (i < 0) throw new ToolInputError(`Unknown weekday "${v}". Use Mon to Sun.`);
        f.dow = String(i);
        break;
      }
      case "status": f.status = pick("status", v, ["open", "closed"]); break;
      case "outcome": f.outcome = pick("outcome", v, ["win", "loss"]); break;
      case "text": f.q = v; break;
    }
    applied.push(`${c.field}=${v}`);
  }
  if (account) f.accountId = account;
  const trades = applyFilter(base, f, MISTAKE_LABEL).filter((t) => (!strategy || t.strategyName === strategy) && (!setup || t.setupName === setup));
  const scope = account ? `account "${d.accounts.find((a) => a.id === account)?.name ?? ""}"` : "all active accounts";
  return { trades, closed: trades.filter((t) => t.status === "closed" && t.netPnl !== null), applied, scope };
}

function currencies(d: CoachData, ts: EnrichedTrade[]) {
  const cur = [...new Set(ts.map((t) => d.accounts.find((a) => a.id === t.accountId)?.currency ?? "USD"))];
  return cur.length > 1 ? `${cur.join(" + ")} (P&L sums mix currencies)` : cur[0] ?? null;
}

// ───────────── tools ─────────────

interface CoachTool { name: string; description: string; schema: z.ZodType; run: (d: CoachData, args: unknown) => unknown }
function tool<S extends z.ZodType>(name: string, description: string, schema: S, run: (d: CoachData, a: z.infer<S>) => unknown): CoachTool {
  return { name, description, schema, run: run as (d: CoachData, a: unknown) => unknown };
}

const DIMENSIONS = ["symbol", "session", "strategy", "setup", "quality", "timeframe", "direction", "day", "emotion", "trend_alignment", "planned_rr", "month"] as const;
const DIM_FN: Record<(typeof DIMENSIONS)[number], (t: EnrichedTrade) => string | null> = {
  symbol: (t) => t.symbol, session: (t) => t.session, strategy: (t) => t.strategyName ?? "No strategy", setup: (t) => t.setupName,
  quality: (t) => t.setupQuality, timeframe: (t) => t.timeframe, direction: (t) => t.direction, day: (t) => DAYS[t.dow],
  emotion: (t) => t.emotionBefore, trend_alignment: (t) => alignment(t), planned_rr: (t) => rrBucket(t.plannedRr), month: (t) => t.day.slice(0, 7),
};

// The same characteristics similarTrades() compares (src/domain/review.ts).
const TRAITS: [string, (t: EnrichedTrade) => string | null][] = [
  ["Strategy", (t) => t.strategyName], ["Setup", (t) => t.setupName], ["Symbol", (t) => t.symbol], ["Session", (t) => t.session],
  ["Quality", (t) => t.setupQuality], ["Trend", (t) => alignment(t)], ["Target", (t) => rrBucket(t.plannedRr)], ["Timeframe", (t) => t.timeframe],
];

const PSYCH_FLAGS: [string, string][] = [["FOMO", "fomo"], ["Revenge", "revenge"], ["Moved stop", "moved_stop"], ["Exited early", "early_exit"], ["Late entry", "late_entry"], ["Overtraded", "overtrading"], ["Oversized", "oversized"]];
const RATING = ["absent", "partial", "clear"];
const NOTE_FIELDS = ["why", "observed", "thesis", "whatHappened", "didWell", "didPoorly", "wouldChange", "lesson"] as const;
const SEQ = z.strictObject({ seq: z.number().int().describe("The trade number shown as #<number> in the journal.") });

function getTrade(d: CoachData, seq: number) {
  const T = schema.trades;
  const row = db.query.trades.findFirst({
    where: and(eq(T.userId, d.userId), eq(T.seq, seq)),
    with: {
      notes: true, psychology: true, emotions: true, mistakes: true, factors: true, account: true,
      checklist: { orderBy: asc(schema.checklistResponses.sort) }, images: { columns: { id: true, kind: true } },
    },
  }).sync();
  const t = d.bySeq(seq);
  if (!row || !t) throw new ToolInputError(`There is no trade #${seq} in this journal.`);
  const A = schema.aiAnalysis;
  const latest = (kind: "screenshot" | "trade_review") =>
    db.select().from(A).where(and(eq(A.userId, d.userId), eq(A.tradeId, row.id), eq(A.kind, kind), eq(A.status, "ok"))).orderBy(desc(A.createdAt), desc(A.id)).limit(5).all();
  let shot: ScreenshotAnalysis | null = null, strategyChanged = false;
  for (const r of latest("screenshot")) {
    try {
      const p = ScreenshotAnalysis.safeParse(JSON.parse(r.output));
      // the app's chart-vs-record checks are redone against the record as it is now
      if (p.success) { ({ analysis: shot, strategyChanged } = againstCurrentRecord(p.data, row, t.strategyName)); break; }
    } catch { /* unreadable row: try the next */ }
  }
  const review = latest("trade_review")[0];
  const ctx = contextFor(d.userId, row.id);
  const ctxState = ctx ? stateOf(ctx, row) : "none";
  const factorLabels = new Map(db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, d.userId)).all().map((f) => [f.key, f.label]));
  const history = d.allTrades().filter((h) => h.accountId === t.accountId);
  const app = reviewTrade(t, history, getRiskRules(d.userId));
  const p = row.psychology;
  return compact({
    seq: row.seq, symbol: row.symbol, direction: row.direction, status: row.status, account: row.account.name, currency: row.account.currency,
    opened: fmtTime(row.openedAt, d.tz), closed: fmtTime(row.closedAt, d.tz), source: row.source,
    strategy: t.strategyName, setup: t.setupName, quality: row.setupQuality, session: row.session, timeframe: row.timeframe,
    marketCondition: row.marketCondition, trend: row.trend, htfBias: row.htfBias, entryConfirmation: row.entryConfirmation, confluences: t.confluences,
    prices: compact({ entry: row.entryPrice, stop: row.initialStop, takeProfit: row.takeProfit, exit: row.exitPrice, sizeLots: row.sizeLots }),
    risk: compact({ amount: r2(row.riskAmount), pct: r2(row.riskPct) }),
    result: compact({ netPnl: r2(row.netPnl), grossPnl: r2(row.grossPnl), commission: r2(row.commission), swap: r2(row.swap), r: r2(t.rMultiple), plannedRr: r2(row.plannedRr) }),
    setupScore: r2(row.setupScore),
    factorRatings: row.factors.map((f) => `${factorLabels.get(f.factorKey) ?? f.factorKey}: ${RATING[f.rating] ?? f.rating}`),
    notes: row.notes ? compact(Object.fromEntries(NOTE_FIELDS.map((k) => [k, clip(row.notes![k], 800)]))) : null,
    psychology: p || row.emotions.length ? compact({
      confidence: p?.confidence ?? null, discipline: p?.discipline ?? null, followedPlan: p?.followedPlan ?? null,
      flags: p ? [p.fomo && "FOMO", p.revenge && "revenge", p.movedStop && "moved stop", p.exitedEarly && "exited early", p.overtraded && "overtraded", p.lateEntry && "late entry", p.oversized && "oversized"].filter(Boolean) : [],
      emotions: row.emotions.map((e) => `${e.phase}: ${e.emotion}${e.intensity ? ` (${e.intensity}/10)` : ""}`),
    }) : null,
    mistakes: row.mistakes.map((m) => compact({ mistake: MISTAKE_LABEL[m.mistakeKey] ?? m.mistakeKey, taggedBy: m.source === "rule" ? "app rule" : m.source, costR: r2(m.costR), note: clip(m.note, 200) })),
    checklist: row.checklist.slice(0, 30).map((c) => compact({ phase: c.phase, item: c.item, checked: c.checked, answer: clip(c.answer, 200) })),
    screenshots: row.images.length ? `${row.images.length} (${uniq(row.images.map((i) => i.kind)).join(", ")})` : "none",
    screenshotAnalysis: shot ? compact({
      note: "Read from the screenshot by the AI earlier. Observed = visible in the image; inferred = an interpretation.",
      chartSource: shot.chartSource, summary: shot.summary, observed: shot.observed.slice(0, 8), inferred: shot.inferred.slice(0, 8), unknown: shot.unknown.slice(0, 6),
      strategyFit: compact({ note: strategyChanged ? "Checked against a strategy the trade no longer has; these rules may not be current." : null, overall: shot.strategyFit.overall, summary: shot.strategyFit.summary, rules: shot.strategyFit.rules.slice(0, 15).map((r) => `${r.status}: ${r.rule}`) }),
      discrepancies: shot.discrepancies.slice(0, 6).map((x) => `${x.topic}: chart ${x.chart} vs record ${x.record}`),
    }) : null,
    aiReview: review ? { note: "An earlier AI review of this trade.", review: storedJson(review.output) } : null,
    marketContext: !ctx ? null : ctxState === "stale"
      ? { note: "Not usable: the trade's symbol, entry time or entry price changed after the market context was computed. Treat it as unknown.", status: "stale" }
      : compact({
        note: "Computed by the app from market data at entry (its own definitions, not FXAlexG rules).", status: ctx.status, trend: ctx.trend, htfBias: ctx.htfBias,
        volatility: ctx.volatility, atr: ctx.atr, nearKeyLevel: ctx.nearKeyLevel, session: ctx.session, error: ctx.status === "error" ? clip(ctx.error, 200) : null,
      }),
    appChecks: compact({ note: "Deterministic checks the app computed from the record and rules.", well: app.well, issues: app.issues }),
  });
}

function compareToHistory(d: CoachData, seq: number) {
  const t = d.bySeq(seq);
  if (!t) throw new ToolInputError(`There is no trade #${seq} in this journal.`);
  const history = d.allTrades().filter((h) => h.accountId === t.accountId);
  const sim = similarTrades(t, history);
  const prior = history.filter((h) => h.id !== t.id && h.netPnl !== null && h.openedAt < t.openedAt);
  const base = summarize(prior);
  const winners = prior.filter((h) => (h.netPnl ?? 0) > 0), losers = prior.filter((h) => (h.netPnl ?? 0) < 0);
  const traits = TRAITS.flatMap(([name, fn]) => {
    const value = fn(t);
    if (!value) return [];
    const g = statFor(value, prior.filter((h) => fn(h) === value), base.avgR);
    return [compact({
      trait: name, value, winnersWithIt: `${winners.filter((h) => fn(h) === value).length} of ${winners.length}`, losersWithIt: `${losers.filter((h) => fn(h) === value).length} of ${losers.length}`,
      pastTradesWithIt: g.n, winRatePct: pct(g.winRate), avgR: r2(g.avgR), evidence: STRENGTH_LABEL[g.strength],
      betterThanYourAverage: g.n >= 10 && g.avgR !== null && base.avgR !== null ? g.avgR > base.avgR : null,
    })];
  });
  return compact({
    trade: `#${t.seq} ${t.symbol} ${t.direction} (${t.day}${t.status === "open" ? ", still open" : ""})`,
    note: "Describes how earlier closed trades in the same account went. It is history, not a prediction for this trade.",
    baseline: { n: base.count, winRatePct: pct(base.winRate), avgR: r2(base.avgR) },
    traits,
    traitsSummary: `${traits.filter((x) => x.betterThanYourAverage === true).length} of ${traits.length} known characteristics have a better-than-average history with at least 10 past trades; ${traits.filter((x) => (x.pastTradesWithIt ?? 0) < 10).length} have under 10 past trades.`,
    similarTrades: sim.stat ? compact({
      rule: `Earlier closed trades sharing at least ${sim.threshold} of these ${sim.traits.length} characteristics`,
      n: sim.stat.n, winRatePct: pct(sim.stat.winRate), avgR: r2(sim.stat.avgR), totalR: r2(sim.stat.totalR), evidence: STRENGTH_LABEL[sim.stat.strength],
      examples: [...(sim.matches as EnrichedTrade[])].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime()).slice(0, 10).map((m) => `#${m.seq} ${m.day} ${r2(m.rMultiple) ?? "?"}R`),
    }) : `No earlier closed trade shares at least ${sim.threshold} of ${sim.traits.length} known characteristics.`,
  });
}

const TOOLS: CoachTool[] = [
  tool("get_performance", "Overall results for trades matching the conditions: counts, win rate with 95% range, net P&L, profit factor, expectancy, average/median/total R, streaks, max drawdown in R, and a verdict on whether average R is distinguishable from zero (needs 20+ trades).",
    z.strictObject({ conditions: Conditions }),
    (d, a) => {
      const { trades, closed, applied, scope } = select(d, a.conditions);
      const s = summarize(closed);
      const rs = closed.map((t) => t.rMultiple).filter((x): x is number => x !== null);
      const v = strategyVerdict(rs);
      const days = trades.map((t) => t.day).sort();
      return compact({
        scope, applied, matched: trades.length, open: trades.filter((t) => t.status === "open").length, firstDay: days[0], lastDay: days[days.length - 1],
        closed: compact({
          n: s.count, wins: s.wins, losses: s.losses, breakevens: s.breakevens, winRatePct: pct(s.winRate), currency: currencies(d, closed),
          netPnl: r2(s.netPnl), profitFactor: s.profitFactor === Infinity ? "no losing trades" : r2(s.profitFactor), expectancyPerTrade: r2(s.expectancy),
          tradesWithR: s.rCount, avgR: r2(s.avgR), medianR: r2(s.medianR), totalR: r2(s.totalR), avgWinR: r2(s.avgWinR), avgLossR: r2(s.avgLossR),
          largestWin: r2(s.largestWin), largestLoss: r2(s.largestLoss), currentStreak: s.currentStreak.length ? `${s.currentStreak.length} ${s.currentStreak.kind}${s.currentStreak.length > 1 ? "s" : ""}` : null,
          bestWinStreak: s.bestWinStreak, worstLossStreak: s.worstLossStreak, maxDrawdownR: r2(maxDrawdown(equityCurve(closed, 0)).r),
        }),
        verdict: `${v.label}: ${v.detail}`,
        sample: sampleNote(s.count),
      });
    }),

  tool("breakdown", "Closed-trade results grouped by one dimension (one row per value) with n, win rate and 95% range, average/median/total R, net P&L and an evidence label. emotion = emotion recorded before entry; trend_alignment = entry with or against the higher-timeframe bias; planned_rr = planned reward:risk bucket; day = weekday the trade opened.",
    z.strictObject({ dimension: z.enum(DIMENSIONS), conditions: Conditions }),
    (d, a) => {
      const { closed, applied, scope } = select(d, a.conditions);
      const s = summarize(closed);
      const fn = DIM_FN[a.dimension];
      const rows = groupStats(closed, fn, s.avgR);
      return compact({
        scope, applied, dimension: a.dimension, baseline: compact({ n: s.count, winRatePct: pct(s.winRate), avgR: r2(s.avgR) }),
        rows: rows.slice(0, 20).map(groupRow), omittedRows: rows.length > 20 ? rows.length - 20 : null,
        tradesWithoutValue: closed.filter((t) => !fn(t)).length || null, sample: sampleNote(s.count),
      });
    }),

  tool("list_trades", "Individual trades matching the conditions, sorted. Use it for 'best / worst trades', recent trades or examples. Returns at most 20 rows (limit is clamped to 1-20) plus the total matched.",
    z.strictObject({ conditions: Conditions, sort: z.enum(["date", "pnl", "r"]), order: z.enum(["desc", "asc"]), limit: z.number().int().describe("1 to 20") }),
    (d, a) => {
      const { trades, applied, scope } = select(d, a.conditions);
      const key = (t: EnrichedTrade) => (a.sort === "date" ? (t.closedAt ?? t.openedAt).getTime() : a.sort === "pnl" ? t.netPnl : t.rMultiple);
      const dir = a.order === "asc" ? 1 : -1;
      const sorted = [...trades].sort((x, y) => {
        const kx = key(x), ky = key(y);
        if (kx === null || ky === null) return kx === ky ? 0 : kx === null ? 1 : -1; // unknown values last
        return dir * (kx - ky);
      });
      const limit = Math.min(20, Math.max(1, Math.round(a.limit)));
      const multi = new Set(trades.map((t) => t.accountId)).size > 1;
      return compact({ scope, applied, matched: trades.length, currency: currencies(d, trades), sortedBy: `${a.sort} ${a.order}`, trades: sorted.slice(0, limit).map((t) => tradeRow(t, multi)) });
    }),

  tool("get_trade", "Everything recorded for one trade: fields, prices, result, notes, psychology, mistakes, checklist, factor ratings, the latest AI screenshot reading, the latest AI review, the app's market context at entry, and the app's own rule checks.",
    SEQ, (d, a) => getTrade(d, a.seq)),

  tool("compare_to_history", "Compares one trade with earlier closed trades in the same account: for each of its characteristics, how many past winners and losers shared it and how trades with it performed; plus the group of closely similar trades. Use it for 'is this consistent with my winners'.",
    SEQ, (d, a) => compareToHistory(d, a.seq)),

  tool("find_edges", "The trader's strongest and weakest conditions (single conditions and pairs, each with at least 5 closed trades) ranked by average R, with small groups shrunk toward the average. Every row has n and an evidence label; most rows on small journals are weak or insufficient.",
    z.strictObject({ conditions: Conditions }),
    (d, a) => {
      const { closed, applied, scope } = select(d, a.conditions);
      const e = personalEdges(closed);
      const row = (c: (typeof e.strongest)[number]) => compact({ conditions: c.conditions.map((x) => `${x.dim}: ${x.value}`).join(" + "), ...groupRow(c.stat), value: undefined });
      return compact({ scope, applied, baseline: { n: closed.length, avgR: r2(e.baselineAvgR) }, strongest: e.strongest.map(row), weakest: e.weakest.map(row), sample: sampleNote(closed.length) });
    }),

  tool("mistakes", "Mistakes on closed trades: how often each occurred, realised R lost on losing trades with it, estimated R left on the table (early exits), results of trades with it, and where it happens most. Also compares trades with and without any mistake.",
    z.strictObject({ conditions: Conditions }),
    (d, a) => {
      const { closed, applied, scope } = select(d, a.conditions);
      const s = summarize(closed);
      const dirty = closed.filter((t) => t.mistakes.length), clean = closed.filter((t) => !t.mistakes.length);
      const ds = summarize(dirty), cs = summarize(clean);
      return compact({
        scope, applied, closedTrades: closed.length, tradesWithAMistake: dirty.length,
        withMistakes: compact({ n: ds.count, avgR: r2(ds.avgR), totalR: r2(ds.totalR), winRatePct: pct(ds.winRate) }),
        clean: compact({ n: cs.count, avgR: r2(cs.avgR), totalR: r2(cs.totalR), winRatePct: pct(cs.winRate) }),
        mistakes: mistakeInsights(closed, s.avgR).slice(0, 15).map((m) => compact({
          mistake: m.label, count: m.count, realisedLossR: r2(m.costR), leftOnTableR: m.opportunityR ? r2(m.opportunityR) : null,
          tradesWithIt: compact({ n: m.stat.n, winRatePct: pct(m.stat.winRate), avgR: r2(m.stat.avgR), evidence: STRENGTH_LABEL[m.stat.strength] }),
          mostCommon: m.mostCommon.map((x) => `${x.dim}: ${x.value} (${Math.round(x.share * 100)}%)`),
        })),
        sample: sampleNote(closed.length),
      });
    }),

  tool("psychology", "How recorded state of mind lines up with results on closed trades: confidence and discipline (1-10 buckets), plan adherence, emotion before entry and during the trade, and mistake tags (marked by the trader or detected by their risk rules). Every row has n and an evidence label. Correlation, not cause.",
    z.strictObject({ conditions: Conditions }),
    (d, a) => {
      const { closed, applied, scope } = select(d, a.conditions);
      const base = summarize(closed).avgR;
      const rows = (gs: GroupStat[]) => gs.filter((g) => g.n > 0).map(groupRow);
      return compact({
        scope, applied, closedTrades: closed.length,
        confidence: rows(scaleBuckets(closed, (t) => t.confidence, base)), discipline: rows(scaleBuckets(closed, (t) => t.discipline, base)),
        followedPlan: rows(groupStats(closed.filter((t) => t.followedPlan !== null), (t) => (t.followedPlan ? "Followed plan" : "Did not follow plan"), base)),
        emotionBeforeEntry: rows(groupStats(closed, (t) => t.emotionBefore, base)), emotionDuring: rows(groupStats(closed, (t) => t.emotionDuring, base)),
        flags: PSYCH_FLAGS.flatMap(([label, key]) => rows(groupStats(closed.filter((t) => t.mistakes.includes(key)), () => label, base))),
        sample: sampleNote(closed.length),
      });
    }),

  tool("strategies", "The trader's strategies: description, preferred sessions/pairs/conditions, setups, every rule / confirmation / invalidation / checklist item (with the FXAlexG concept it came from), and closed-trade results per strategy in the default scope with a verdict.",
    z.strictObject({}),
    (d) => {
      const list = db.query.strategies.findMany({ where: eq(schema.strategies.userId, d.userId), with: { rules: { orderBy: asc(schema.strategyRules.sort) }, setups: true } }).sync();
      const closed = d.scoped().filter((t) => t.status === "closed" && t.netPnl !== null);
      const stats = (ts: EnrichedTrade[]) => {
        const s = summarize(ts);
        const v = strategyVerdict(ts.map((t) => t.rMultiple).filter((x): x is number => x !== null));
        return compact({ n: s.count, winRatePct: pct(s.winRate), avgR: r2(s.avgR), totalR: r2(s.totalR), netPnl: r2(s.netPnl), verdict: `${v.label}: ${v.detail}` });
      };
      const none = closed.filter((t) => !t.strategyId);
      return compact({
        scope: d.scopeLabel(),
        strategies: list.map((s) => compact({
          name: s.name, active: s.isActive, template: s.source === "fxalexg_template" ? "FXAlexG template (edited copy belongs to the trader)" : null,
          description: clip(s.description, 500), preferredSessions: s.preferredSessions, preferredPairs: s.preferredPairs, preferredConditions: s.preferredConditions,
          setups: s.setups.map((x) => x.name),
          rules: s.rules.map((r) => `${r.kind}${r.isRequired ? " (required)" : " (optional)"}: ${r.text}${r.kbConceptSlug ? ` [kb: ${r.kbConceptSlug}]` : ""}`),
          results: stats(closed.filter((t) => t.strategyId === s.id)),
        })),
        tradesWithoutStrategy: none.length ? stats(none) : null,
      });
    }),

  tool("reviews", "The trader's own written weekly or monthly reviews (newest first) and any stored AI summaries of those periods. limit is clamped to 1-12.",
    z.strictObject({ kind: z.enum(["weekly", "monthly"]), limit: z.number().int().describe("1 to 12") }),
    (d, a) => {
      const limit = Math.min(12, Math.max(1, Math.round(a.limit)));
      const A = schema.aiAnalysis;
      const ai = db.select().from(A).where(and(eq(A.userId, d.userId), eq(A.kind, a.kind), eq(A.status, "ok"))).orderBy(desc(A.createdAt), desc(A.id)).limit(limit * 3).all();
      const newest = new Map<string, (typeof ai)[number]>();
      for (const r of ai) if (!newest.has(r.periodKey ?? r.id)) newest.set(r.periodKey ?? r.id, r);
      const aiSummaries = [...newest.values()].slice(0, limit).map((r) => ({ period: r.periodKey, generated: ymd(r.createdAt, d.tz), summary: storedJson(r.output) }));
      if (a.kind === "weekly") {
        const W = schema.weeklyReviews;
        const rows = db.select().from(W).where(eq(W.userId, d.userId)).orderBy(desc(W.weekStart)).limit(limit).all();
        return compact({
          written: rows.map((w) => compact({
            weekStart: w.weekStart, completed: !!w.completedAt, followedRules: clip(w.followedRules, 400), overtraded: clip(w.overtraded, 400), forcedSetups: clip(w.forcedSetups, 400),
            respectedRisk: clip(w.respectedRisk, 400), followedPlan: clip(w.followedPlan, 400), emotions: clip(w.emotions, 400), lostDiscipline: clip(w.lostDiscipline, 400),
            triggers: clip(w.triggers, 400), keepDoing: clip(w.keepDoing, 400), stopDoing: clip(w.stopDoing, 400), change: clip(w.change, 400),
            focusNextWeek: clip(w.focusNextWeek, 400), aiSummary: clip(w.aiSummary, 800),
          })),
          aiSummaries, note: rows.length ? null : "No weekly reviews written yet.",
        });
      }
      const M = schema.monthlyReviews;
      const rows = db.select().from(M).where(eq(M.userId, d.userId)).orderBy(desc(M.month)).limit(limit).all();
      return compact({
        written: rows.map((m) => compact({ month: m.month, notes: clip(m.notes, 800), biggestImprovement: clip(m.biggestImprovement, 400), focusNextMonth: clip(m.focusNextMonth, 400), aiSummary: clip(m.aiSummary, 800) })),
        aiSummaries, note: rows.length ? null : "No monthly reviews written yet.",
      });
    }),

  tool("risk_rules", "The trader's configured risk rules (max risk per trade, daily/weekly loss limits, trades per day, consecutive losses, minimum R:R, trading hours, restricted days, checklist requirement). Rules not set are listed as such.",
    z.strictObject({}),
    (d) => {
      const r = getRiskRules(d.userId);
      const rules = {
        maxRiskPerTradePct: r.maxRiskPct ?? null, maxDailyLossPct: r.maxDailyLossPct ?? null, maxWeeklyLossPct: r.maxWeeklyLossPct ?? null,
        maxTradesPerDay: r.maxTradesPerDay ?? null, maxConsecutiveLosses: r.maxConsecutiveLosses ?? null, minPlannedRr: r.minRr ?? null,
        tradingHours: r.tradingHoursStart && r.tradingHoursEnd ? `${r.tradingHoursStart}-${r.tradingHoursEnd} (${d.tz})` : null,
        restrictedDays: r.restrictedDays ? r.restrictedDays.split(",").map((x) => DAYS[Number(x)]).filter(Boolean).join(", ") : null,
        checklistRequired: r.requireChecklist ?? false,
      };
      return { ...compact(rules), notSet: Object.entries(rules).filter(([, v]) => v === null).map(([k]) => k) };
    }),

  tool("search_methodology", "Searches the FXAlexG methodology knowledge base (built from his public website, Telegram channel and third-party write-ups; no YouTube videos). Returns matching concepts with category, confidence and sources. Only these concepts may be attributed to FXAlexG.",
    z.strictObject({ query: z.string() }),
    (_d, a) => {
      const words = lower(a.query).split(/[^a-z0-9+]+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 12);
      if (!words.length) throw new ToolInputError("The query has no searchable words.");
      const scored = FXALEXG_KB.map((c) => {
        const fields: [string, number][] = [[c.name, 3], [c.slug.replace(/-/g, " "), 3], [c.area, 2], [c.definition, 1], [c.exceptions ?? "", 1], [c.examples ?? "", 1], [(c.related ?? []).join(" "), 1], [c.sources.map((s) => s.summary).join(" "), 1]];
        const score = words.reduce((acc, w) => acc + fields.reduce((s, [text, wt]) => s + (lower(text).includes(w) ? wt : 0), 0), 0);
        return { c, score };
      }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, 5);
      if (!scored.length) return { matches: [], note: "Nothing in the knowledge base matches. Say this is not established from available source material." };
      return {
        matches: scored.map(({ c }) => compact({
          slug: c.slug, name: c.name, area: c.area, category: c.category, confidence: c.confidence, definition: c.definition, exceptions: c.exceptions, examples: c.examples,
          sources: c.sources.map((s) => `${s.title} (${s.kind}) ${s.url}: ${s.summary}`),
        })),
      };
    }),
];

const STOP = new Set(["the", "and", "for", "what", "does", "his", "how", "with", "about", "fxalexg", "alex", "rule", "rules", "say", "says"]);

// ───────────── API definitions and execution ─────────────

/** JSON Schema for strict tool use: every object closed, no numeric/length constraints (validated here instead). */
function apiSchema(s: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const drop = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "default"]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const o = Object.fromEntries(Object.entries(v).filter(([k]) => !drop.has(k)).map(([k, x]) => [k, k === "properties" ? Object.fromEntries(Object.entries(x as object).map(([pk, pv]) => [pk, walk(pv)])) : walk(x)]));
    if (o.type === "object") o.additionalProperties = false;
    return o;
  };
  return walk(z.toJSONSchema(s, { io: "input" })) as Anthropic.Beta.BetaTool.InputSchema;
}

/**
 * Tool definitions sent with every coach request. strict: true makes the API keep arguments to the schema.
 * eager_input_streaming stays off: inputs are a few short fields, and buffered input keeps the server-side validation.
 */
export const COACH_TOOLS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({ type: "custom", name: t.name, description: t.description, input_schema: apiSchema(t.schema), strict: true }));
export const COACH_TOOL_NAMES = TOOLS.map((t) => t.name);

/** Runs one tool call for this user. Invalid input and failures come back as error results the model can read. */
export function runCoachTool(d: CoachData, name: string, input: unknown): { content: string; isError: boolean } {
  const t = TOOLS.find((x) => x.name === name);
  const fail = (error: string) => ({ content: JSON.stringify({ error }), isError: true });
  if (!t) return fail(`Unknown tool "${name}".`);
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return fail(`Invalid input: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  try {
    return { content: JSON.stringify(t.run(d, parsed.data)), isError: false };
  } catch (e) {
    if (e instanceof ToolInputError) return fail(e.message);
    console.error(`[ai:coach] tool ${name} failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`);
    return fail("This lookup failed inside the app. Answer without it and say the data couldn't be read.");
  }
}
