import { and, desc, eq, inArray, max } from "drizzle-orm";
import { db, schema } from "../db";
import { newId } from "../ids";
import { loadTrades, userAccounts, type EnrichedTrade } from "../analytics";
import { NotFoundError, getRiskRules, getUserTz } from "../trades";
import { AiNotConfiguredError, aiConfigured, aiModel, describeAiError, logAiFailure, takeAiQuota } from "./client";
import { PROMPT_VERSION } from "./prompts";
import { callStructured } from "./review";
import { periodReport } from "@/domain/period";
import {
  MONTHLY_ANSWER_LABELS, PeriodModelOutput, WEEKLY_ANSWER_LABELS, buildPeriodPacket, finalizePeriod, normalizePeriodJson, parseStoredPeriod, periodKeyOf, periodSlices, validPeriod,
  type PeriodKind, type PeriodPacket, type StoredPeriodSummary,
} from "@/domain/ai/period";

/**
 * AI weekly and monthly summaries (spec 17 and 18), stored in ai_analysis (kind "weekly" or
 * "monthly") under period_key "<Monday or YYYY-MM>|<accountId or all>". The trader's own written
 * review is read as input and never changed.
 */

export const NOT_CONFIGURED = "Not configured: add ANTHROPIC_API_KEY on the server to enable AI summaries.";

const SHARED = `- Every point is one or two sentences with a basis: "history" for statistics the app computed, "data" for what the trader recorded (trades, mistakes, emotions, answers), "inference" for an interpretation, "opinion" for advice. Up to 5 points per list; fewer is fine.
- Give n with every number about a group. Use only numbers that appear in the message; a simple difference between two of them is fine if you say it is a difference.
- Respect the sample_size_caveats section. Under 10 trades in a group, describe it but draw no conclusion; never call anything an edge or a pattern from fewer than 30 trades.
- Process over outcome: rules followed, risk respected, mistakes and emotions matter more than one period's P&L.
- your_written_review is the trader's own reflection. Refer to it, agree or disagree with data, but never rewrite it; if it's missing, don't mention it.
- caveats: sample-size warnings specific to this period that the sample_size_caveats section doesn't already state; empty if none.`;

export const WEEKLY_INSTRUCTIONS = `Task: summarise the trader's week from the period data in the user message, as a companion to their own weekly review.
- summary: two to four plain sentences: the week's results with n, then how the process went.
- performance: results by strategy, setup, session and symbol, and what stands out.
- process: rule adherence, plan following, risk per trade, number of trades per day, recorded mistakes.
- psychology: emotions and psychology flags, and how they lined up with decisions. Correlation only, with n.
- keep, stop, change: specific behaviours from this week's data (what to continue, what to stop, what to adjust).
- focus.text: one concrete focus for next week. It is your opinion.
- comparison: return an empty list for a weekly summary.
${SHARED}`;

export const MONTHLY_INSTRUCTIONS = `Task: summarise the trader's month from the period data in the user message, as a companion to their own monthly review.
- summary: two to four plain sentences: the month's results with n, then how the process went.
- performance: results by strategy, setup, session and symbol, and what stands out.
- process: rule adherence, plan following, risk per trade, number of trades per day, recorded mistakes.
- psychology: emotions and psychology flags, and how they lined up with decisions. Correlation only, with n.
- keep, stop, change: specific behaviours from this month's data (what to continue, what to stop, what to adjust).
- focus.text: one concrete focus for next month. It is your opinion.
- comparison: compare with the previous month and the earlier months listed: trades, win rate, average R, mistakes per trade, recurring mistakes. Say when either sample is small.
${SHARED}`;

export class PeriodInputError extends Error {}

/** The closed trades in the same account scope the review pages use (selected account, or all non-archived accounts). */
function scopedClosed(userId: string, tz: string, accountId?: string | null) {
  const accounts = userAccounts(userId);
  if (accountId && !accounts.some((a) => a.id === accountId)) throw new NotFoundError("Account not found");
  const all = loadTrades(userId, tz);
  const trades = accountId ? all.filter((t) => t.accountId === accountId) : all.filter((t) => accounts.some((a) => a.id === t.accountId));
  return { closed: trades.filter((t) => t.status === "closed"), accounts };
}

function answersFor(userId: string, kind: PeriodKind, period: string) {
  if (kind === "weekly") {
    const w = db.select().from(schema.weeklyReviews).where(and(eq(schema.weeklyReviews.userId, userId), eq(schema.weeklyReviews.weekStart, period))).get();
    const answers = w ? WEEKLY_ANSWER_LABELS.map(([k, question]) => ({ question, answer: String((w as Record<string, unknown>)[k] ?? "") })).filter((a) => a.answer.trim()) : [];
    return { answers, changed: w?.updatedAt.getTime() ?? null };
  }
  const m = db.select().from(schema.monthlyReviews).where(and(eq(schema.monthlyReviews.userId, userId), eq(schema.monthlyReviews.month, period))).get();
  const answers = m ? MONTHLY_ANSWER_LABELS.map(([k, question]) => ({ question, answer: String((m as Record<string, unknown>)[k] ?? "") })).filter((a) => a.answer.trim()) : [];
  return { answers, changed: m?.updatedAt.getTime() ?? null };
}

function lastChange(userId: string, ids: string[]) {
  if (!ids.length) return null;
  const T = schema.trades;
  const r = db.select({ m: max(T.updatedAt) }).from(T).where(and(eq(T.userId, userId), inArray(T.id, ids))).get();
  return r?.m ? new Date(r.m).getTime() : null;
}

export interface PeriodInput { packet: PeriodPacket; basedOn: StoredPeriodSummary["basedOn"] }

/** The period's trades in scope and what a summary of it depends on. User-scoped throughout. */
function loadPeriod(userId: string, kind: PeriodKind, period: string, accountId?: string | null) {
  if (!validPeriod(kind, period)) throw new PeriodInputError(kind === "weekly" ? "Invalid week." : "Invalid month.");
  const tz = getUserTz(userId);
  const { closed, accounts } = scopedClosed(userId, tz, accountId);
  const slices = periodSlices(kind, period, closed);
  const answers = answersFor(userId, kind, period);
  const basedOn = { trades: slices.current.length, lastTradeChange: lastChange(userId, slices.current.map((t: EnrichedTrade) => t.id)), answersChanged: answers.changed };
  return { slices, acct: accountId ? accounts.find((a) => a.id === accountId) : undefined, answers: answers.answers, basedOn };
}

/** Builds the packet from this user's data only, in the given account scope. */
export function periodInputFor(userId: string, kind: PeriodKind, period: string, accountId?: string | null): PeriodInput {
  const { slices: s, acct, answers, basedOn } = loadPeriod(userId, kind, period, accountId);
  const user = db.select({ baseCurrency: schema.users.baseCurrency }).from(schema.users).where(eq(schema.users.id, userId)).get();
  const packet = buildPeriodPacket({
    kind, period,
    scopeLabel: acct ? acct.name : "all accounts combined",
    currency: acct?.currency ?? user?.baseCurrency ?? "USD",
    current: s.current, previous: s.previous, history: s.history,
    report: periodReport(s.current, s.previous),
    answers,
    riskRules: getRiskRules(userId),
  });
  return { packet, basedOn };
}

function storeRow(v: { userId: string; kind: PeriodKind; periodKey: string; model: string; status: "ok" | "error"; error?: string; output?: string; inputTokens?: number | null; outputTokens?: number | null }) {
  const id = newId();
  db.insert(schema.aiAnalysis).values({
    id, userId: v.userId, kind: v.kind, periodKey: v.periodKey, model: v.model, status: v.status, error: v.error ?? null,
    output: v.output ?? "", inputTokens: v.inputTokens ?? null, outputTokens: v.outputTokens ?? null, createdAt: new Date(),
  }).run();
  return id;
}

export type PeriodResult = { ok: true; id: string; summary: StoredPeriodSummary } | { ok: false; id: string; error: string };

/**
 * Generates and stores the AI summary for a week (Monday date) or month in an account scope.
 * Throws PeriodInputError (bad period, or no closed trades), NotFoundError (account not the user's),
 * AiNotConfiguredError and AiRateLimitError before any API call. API/output failures are stored.
 */
export async function generatePeriodSummary(userId: string, kind: PeriodKind, period: string, accountId?: string | null): Promise<PeriodResult> {
  const { packet, basedOn } = periodInputFor(userId, kind, period, accountId);
  if (!packet.tradeCount) throw new PeriodInputError(`No closed trades in this ${kind === "weekly" ? "week" : "month"}, so there is nothing to summarize.`);
  if (!aiConfigured()) throw new AiNotConfiguredError();
  takeAiQuota(userId);
  const periodKey = periodKeyOf(period, accountId);
  try {
    const { data, usage, model } = await callStructured(PeriodModelOutput, kind === "weekly" ? WEEKLY_INSTRUCTIONS : MONTHLY_INSTRUCTIONS, packet.text, normalizePeriodJson);
    const summary = finalizePeriod(data, { kind, period, caveats: packet.caveats, basedOn, promptVersion: PROMPT_VERSION });
    const id = storeRow({ userId, kind, periodKey, model, status: "ok", output: JSON.stringify(summary), ...usage });
    return { ok: true, id, summary };
  } catch (e) {
    logAiFailure(`${kind} summary`, e);
    const error = describeAiError(e);
    return { ok: false, id: storeRow({ userId, kind, periodKey, model: aiModel(), status: "error", error }), error };
  }
}

type Row = typeof schema.aiAnalysis.$inferSelect;
export interface PeriodSummaryState {
  good: { row: Row; summary: StoredPeriodSummary } | null;
  lastError: Row | null;
  unreadable: boolean;
  /** trades in the period or the written review changed after the summary */
  outOfDate: boolean;
  tradeCount: number;
}

export function periodSummaryState(userId: string, kind: PeriodKind, period: string, accountId?: string | null): PeriodSummaryState {
  const A = schema.aiAnalysis;
  const { basedOn } = loadPeriod(userId, kind, period, accountId);
  const rows = db.select().from(A).where(and(eq(A.userId, userId), eq(A.kind, kind), eq(A.periodKey, periodKeyOf(period, accountId)))).orderBy(desc(A.createdAt), desc(A.id)).limit(20).all();
  let good: PeriodSummaryState["good"] = null, unreadable = false;
  for (const r of rows) {
    if (r.status !== "ok") continue;
    const summary = parseStoredPeriod(r.output);
    if (summary) { good = { row: r, summary }; break; }
    unreadable = true;
  }
  const at = good?.row.createdAt.getTime() ?? 0;
  const outOfDate = !!good && (good.summary.basedOn.trades !== basedOn.trades || (basedOn.lastTradeChange ?? 0) > at || (basedOn.answersChanged ?? 0) > at);
  return { good, unreadable, lastError: rows[0]?.status === "error" ? rows[0] : null, outOfDate, tradeCount: basedOn.trades };
}
