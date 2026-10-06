import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { newId } from "../ids";
import type { SaveOrigin } from "../hooks";
import { loadTrades } from "../analytics";
import { NotFoundError, getRiskRules, getUserTz, refreshRuleMistakes } from "../trades";
import { alertsForTrade } from "../tradingview";
import {
  AiNotConfiguredError, AiOutputError, AiRateLimitError, aiClient, aiConfigured, aiModel, assertUsableStop, describeAiError, effortParams, fallbackParams, logAiFailure, takeAiQuota, usageOf,
} from "./client";
import { contextFor, stateOf } from "../marketdata/context";
import { PROMPT_VERSION, systemBlocks } from "./prompts";
import { reviewTrade } from "@/domain/review";
import { MISTAKES, MISTAKE_LABEL } from "@/domain/mistakes";
import {
  ReviewModelOutput, buildReviewPacket, finalizeReview, normalizeReviewJson, parseStoredReview,
  type ReviewPacket, type ReviewPacketInput, type ScreenshotDigest, type StoredTradeReview,
} from "@/domain/ai/review";

/**
 * AI trade review (spec 22). One structured request per review, built from this user's data
 * only, checked (src/domain/ai/review.ts) and stored in ai_analysis (kind "trade_review").
 */

export const NOT_CONFIGURED = "Not configured: add ANTHROPIC_API_KEY on the server to enable AI trade reviews.";

export const REVIEW_INSTRUCTIONS = `Task: write the post-trade review of one trade from the trader's journal. The user message holds everything the app has on it, in tagged sections:
- trade_record, journal_notes, psychology, checklist, setup_score, mistakes_recorded, tradingview_alerts: the trader's own records (basis "data").
- app_review: the app's checks of this trade's own record against the rules (basis "data").
- similarity: statistics the app computed from the trader's earlier, similar trades (basis "history").
- plan: the strategy's rules and the trader's risk rules, each with an id.
- screenshot_readings: earlier AI readings of the trade's screenshots. Only "Observed" lines may support basis "chart"; "Inferred" lines are "inference".
- market_context: computed by the app from a market-data provider's candles at entry. Use basis "data" and say it is market data.

Fields:
- headline: one plain sentence on how the trade was executed against the plan. Process first; the result is secondary.
- wentWell, issues: up to 5 points each, each naming the field, note, checklist item or statistic it rests on. Judge the decision by the recorded process, not by the profit or loss: a losing trade can be well executed and a winner can break rules.
- planCheck: one entry per plan id. "followed": the record shows the rule was respected (a ticked checklist item, a factor rating, a field value, a note). "broken": the record shows it wasn't, including a mistake the app detected. "not_recorded": nothing recorded shows it either way. For an invalidation rule, "followed" means the trade wasn't taken under that invalidating condition. evidence names the field or quotes the note; for not_recorded, say what is missing. Never mark a rule followed because the trade made money.
- historicalComparison.text: restate only numbers from the similarity section (n, win rate, average R, the baseline, the strength label). Under 10 similar trades, say the sample is too small to conclude anything. With no similar trades, say there isn't enough history yet. Say that this describes past trades, not this one. Add no other numbers.
- suggestedMistakes: mistakes the trader's own records point to that aren't in mistakes_recorded. quote copies a short phrase word for word from journal_notes, psychology, checklist, trade_record or tradingview_alerts (a whole "Label: value" line is fine). evidence is one sentence linking the quote to the mistake. Leave the list empty unless the records clearly support it; never infer a mistake from the outcome alone.
- lesson.text: one specific, actionable sentence for the next trade. It is your opinion.
- Never give the setup a quality score, grade or rating of your own; the app shows the trader's own setup score and grade.

Mistake keys for suggestedMistakes:
${MISTAKES.map((m) => `- ${m.key}: ${m.label}. ${m.description}`).join("\n")}`;

export class ReviewInputError extends Error {}

// ───────────── shared structured call ─────────────

/**
 * One structured-output request. create() is used rather than parse() because parse() throws a
 * generic error on a refusal or a cut-off answer before the stop reason can be checked; this
 * checks the stop reason first, then parses and validates the JSON with the same zod schema.
 */
export async function callStructured<S extends z.ZodType>(outSchema: S, instructions: string, userText: string, normalize: (raw: unknown) => unknown = (x) => x) {
  const model = aiModel();
  const fb = fallbackParams(model);
  const { type, schema: jsonSchema } = betaZodOutputFormat(outSchema);
  const res = await aiClient().beta.messages.create({
    model,
    max_tokens: 16000,
    system: systemBlocks(instructions),
    messages: [{ role: "user", content: userText }],
    output_config: { ...effortParams(model), format: { type, schema: jsonSchema } },
    ...fb,
    betas: [...(fb.betas ?? []), "structured-outputs-2025-12-15"],
  });
  assertUsableStop(res);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new AiOutputError("The AI answer wasn't in the expected format. Try again."); }
  const parsed = outSchema.safeParse(normalize(raw));
  if (!parsed.success) throw new AiOutputError("The AI answer didn't match the expected structure. Try again.");
  return { data: parsed.data as z.infer<S>, usage: usageOf(res), model: res.model || model };
}


// ───────────── the packet (this user's data only) ─────────────

// Lenient readers for stored screenshot analyses: each field is used only if it parses.
const strs = z.array(z.string());
const pick = <T>(s: z.ZodType<T>, v: unknown): T | null => { const r = s.safeParse(v); return r.success ? r.data : null; };

function screenshotDigests(userId: string, tradeId: string): ScreenshotDigest[] {
  const A = schema.aiAnalysis, I = schema.tradeImages;
  const rows = db.select({ imageId: A.imageId, output: A.output, createdAt: A.createdAt, kind: I.kind }).from(A)
    .innerJoin(I, and(eq(I.id, A.imageId), eq(I.userId, userId)))
    .where(and(eq(A.userId, userId), eq(A.tradeId, tradeId), eq(A.kind, "screenshot"), eq(A.status, "ok")))
    .orderBy(desc(A.createdAt), desc(A.id)).all();
  const seen = new Set<string>();
  const out: ScreenshotDigest[] = [];
  for (const r of rows) {
    if (!r.imageId || seen.has(r.imageId)) continue;
    let o: Record<string, unknown>;
    try { o = JSON.parse(r.output) as Record<string, unknown>; } catch { continue; }
    if (!o || typeof o !== "object") continue;
    seen.add(r.imageId);
    const fit = pick(z.object({ overall: z.string().optional(), summary: z.string().optional() }), o.strategyFit);
    out.push({
      kind: r.kind, at: r.createdAt,
      chartSource: pick(z.string(), o.chartSource), summary: pick(z.string(), o.summary),
      observed: (pick(strs, o.observed) ?? []).slice(0, 10), inferred: (pick(strs, o.inferred) ?? []).slice(0, 10), unknown: (pick(strs, o.unknown) ?? []).slice(0, 8),
      fit: fit?.overall ?? null, fitSummary: fit?.summary ?? null,
    });
    if (out.length >= 4) break;
  }
  return out;
}

/** Everything the review needs, read with the user's id on every query. Throws NotFoundError for trades the user doesn't own. */
export function reviewInputFor(userId: string, tradeId: string): ReviewPacketInput {
  const T = schema.trades;
  const row = db.query.trades.findFirst({
    where: and(eq(T.id, tradeId), eq(T.userId, userId)),
    with: {
      notes: true, psychology: true, emotions: true, mistakes: true, factors: true, account: true, setup: true,
      checklist: { orderBy: asc(schema.checklistResponses.sort) },
      strategy: { with: { rules: { orderBy: asc(schema.strategyRules.sort) } } },
    },
  }).sync();
  if (!row || row.account.userId !== userId) throw new NotFoundError("Trade not found");
  const tz = getUserTz(userId);
  const all = loadTrades(userId, tz);
  const t = all.find((x) => x.id === tradeId);
  if (!t) throw new NotFoundError("Trade not found");
  const rules = getRiskRules(userId);
  const review = reviewTrade(t, all.filter((x) => x.accountId === t.accountId), rules);
  const strategy = row.strategy && row.strategy.userId === userId ? row.strategy : null;
  const setup = row.setup && row.setup.userId === userId ? row.setup : null;
  const factorDefs = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, userId)).orderBy(asc(schema.scoreFactors.sort)).all();
  const ratings = new Map(row.factors.filter((f) => f.userId === userId).map((f) => [f.factorKey, f.rating]));
  // only context computed for the trade as it is now: a symbol, entry time or price edit makes it stale
  const stored = contextFor(userId, tradeId);
  const mc = stored && stateOf(stored, row) === "ok" ? stored : null;
  const own = <R extends { userId: string }>(xs: R[]) => xs.filter((x) => x.userId === userId);

  return {
    trade: {
      id: row.id, seq: row.seq, symbol: row.symbol, direction: row.direction, status: row.status, source: row.source, openedAt: row.openedAt, closedAt: row.closedAt,
      entryPrice: row.entryPrice, initialStop: row.initialStop, takeProfit: row.takeProfit, exitPrice: row.exitPrice, sizeLots: row.sizeLots,
      riskAmount: row.riskAmount, riskPct: row.riskPct, grossPnl: row.grossPnl, commission: row.commission, swap: row.swap, fees: row.fees,
      netPnl: row.netPnl, pnlPct: row.pnlPct, rMultiple: row.rMultiple, plannedRr: row.plannedRr, session: row.session, timeframe: row.timeframe,
      marketCondition: row.marketCondition, trend: row.trend, htfBias: row.htfBias, setupQuality: row.setupQuality, entryConfirmation: row.entryConfirmation,
      confluences: row.confluences, setupScore: row.setupScore,
    },
    tz,
    currency: row.account.currency,
    strategy: strategy ? { name: strategy.name, rules: strategy.rules.map((r) => ({ kind: r.kind, text: r.text, required: r.isRequired })) } : null,
    setupName: setup?.name ?? null,
    notes: row.notes && row.notes.userId === userId ? row.notes : null,
    psych: row.psychology && row.psychology.userId === userId ? row.psychology : null,
    emotions: own(row.emotions).sort((a, b) => ["before", "during", "after"].indexOf(a.phase) - ["before", "during", "after"].indexOf(b.phase)).map((e) => ({ phase: e.phase, emotion: e.emotion, intensity: e.intensity })),
    checklist: own(row.checklist).map((c) => ({ phase: c.phase, item: c.item, checked: c.checked, answer: c.answer })),
    factors: factorDefs.map((f) => ({ label: f.label, weight: f.weight, rating: ratings.get(f.key) ?? null })),
    mistakes: own(row.mistakes).map((m) => ({ key: m.mistakeKey, source: m.source, note: m.note })),
    review,
    riskRules: rules,
    alerts: alertsForTrade(userId, tradeId).map(({ alert: a, link: l }) => ({ symbol: a.symbol, timeframe: a.timeframe, side: a.side, price: a.price, setup: a.setup, message: a.message, at: a.alertTime ?? a.receivedAt, status: l.status })),
    screenshots: screenshotDigests(userId, tradeId),
    market: mc ? { provider: mc.provider, instrument: mc.instrument, trend: mc.trend, htfBias: mc.htfBias, session: mc.session, volatility: mc.volatility, atr: mc.atr, nearKeyLevel: mc.nearKeyLevel, computedAt: mc.computedAt } : null,
  };
}

export function reviewPacketFor(userId: string, tradeId: string): ReviewPacket {
  return buildReviewPacket(reviewInputFor(userId, tradeId));
}

// ───────────── generate & store ─────────────

function storeRow(v: { userId: string; tradeId: string; model: string; status: "ok" | "error"; error?: string; output?: string; inputTokens?: number | null; outputTokens?: number | null }) {
  const id = newId();
  db.insert(schema.aiAnalysis).values({
    id, userId: v.userId, tradeId: v.tradeId, kind: "trade_review", model: v.model, status: v.status, error: v.error ?? null,
    output: v.output ?? "", inputTokens: v.inputTokens ?? null, outputTokens: v.outputTokens ?? null, createdAt: new Date(),
  }).run();
  return id;
}

export type ReviewResult = { ok: true; id: string; review: StoredTradeReview } | { ok: false; id: string; error: string };

/**
 * Generates and stores a review for one of the user's closed trades. Throws NotFoundError (not the
 * user's trade), ReviewInputError (trade still open), AiNotConfiguredError and AiRateLimitError
 * before any API call; nothing is stored for those. An API or output failure is stored as an error row.
 */
export async function generateTradeReview(userId: string, tradeId: string): Promise<ReviewResult> {
  const input = reviewInputFor(userId, tradeId);
  if (input.trade.status !== "closed") throw new ReviewInputError("The AI review is written once the trade is closed.");
  if (!aiConfigured()) throw new AiNotConfiguredError();
  const packet = buildReviewPacket(input);
  takeAiQuota(userId);
  try {
    const { data, usage, model } = await callStructured(ReviewModelOutput, REVIEW_INSTRUCTIONS, packet.text, normalizeReviewJson);
    const review = finalizeReview(data, packet, PROMPT_VERSION);
    const id = storeRow({ userId, tradeId, model, status: "ok", output: JSON.stringify(review), ...usage });
    return { ok: true, id, review };
  } catch (e) {
    logAiFailure("trade review", e);
    const error = describeAiError(e);
    return { ok: false, id: storeRow({ userId, tradeId, model: aiModel(), status: "error", error }), error };
  }
}

/** At most this many automatic reviews per save, so one sync can't spend the user's AI quota. */
export const AUTO_MAX_PER_SAVE = 5;
/** MT5 sync also delivers old history; only trades closed this recently count as "just closed". */
export const AUTO_RECENT_MS = 72 * 3600_000;
const inflight = new Set<string>();

/** True while an automatic review of this trade is queued or being written (in this server process). */
export const reviewBeingWritten = (tradeId: string) => inflight.has(tradeId);

/**
 * The automatic review after a save (src/server/hooks.ts). Once per trade, only for closed trades,
 * only when AI is configured and the user's aiAutoReview is on, never for file imports (a bulk
 * import would mean dozens of paid calls; those trades can be reviewed from the trade page).
 *
 * claimAutoReviews picks the trades and marks them in flight straight away (so the trade page shows
 * "being written" instead of offering a second paid review); runClaimedReviews writes them later.
 * Neither throws.
 */
export function claimAutoReviews(userId: string, tradeIds: string[], origin: SaveOrigin): string[] {
  try {
    if (origin === "import" || !aiConfigured()) return [];
    const ids = [...new Set(tradeIds)].filter((x) => typeof x === "string" && x);
    if (!ids.length) return [];
    const user = db.select({ auto: schema.users.aiAutoReview }).from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user?.auto) return [];
    const T = schema.trades, A = schema.aiAnalysis;
    const now = Date.now();
    const closed = db.select({ id: T.id, status: T.status, closedAt: T.closedAt }).from(T).where(and(eq(T.userId, userId), inArray(T.id, ids))).all()
      .filter((t) => t.status === "closed" && (origin !== "mt5_bridge" || (t.closedAt !== null && now - t.closedAt.getTime() <= AUTO_RECENT_MS)));
    if (!closed.length) return [];
    const reviewed = new Set(db.select({ tradeId: A.tradeId }).from(A).where(and(eq(A.userId, userId), eq(A.kind, "trade_review"), inArray(A.tradeId, closed.map((t) => t.id)))).all().map((r) => r.tradeId));
    const todo = closed.filter((t) => !reviewed.has(t.id) && !inflight.has(t.id)).slice(0, AUTO_MAX_PER_SAVE).map((t) => t.id);
    for (const id of todo) inflight.add(id);
    return todo;
  } catch (e) {
    logAiFailure("auto review", e);
    return [];
  }
}

export async function runClaimedReviews(userId: string, claimed: string[]): Promise<void> {
  try {
    for (const id of claimed) {
      try { await generateTradeReview(userId, id); }
      catch (e) { logAiFailure("auto review", e); if (e instanceof AiRateLimitError || e instanceof AiNotConfiguredError) break; }
      finally { inflight.delete(id); }
    }
  } finally {
    for (const id of claimed) inflight.delete(id);
  }
}

export async function autoReviewTrades(userId: string, tradeIds: string[], origin: SaveOrigin): Promise<void> {
  await runClaimedReviews(userId, claimAutoReviews(userId, tradeIds, origin));
}

// ───────────── reading ─────────────

type Row = typeof schema.aiAnalysis.$inferSelect;
export interface TradeReviewState {
  /** newest successful review that still validates against the schema */
  good: { row: Row; review: StoredTradeReview } | null;
  /** set when the newest attempt failed */
  lastError: Row | null;
  /** a newer successful row exists but no longer validates (older format) */
  unreadable: boolean;
  /** the trade was edited after the shown review was written */
  outOfDate: boolean;
  trade: { status: "open" | "closed"; setupScore: number | null; setupQuality: string | null; updatedAt: Date };
  mistakeKeys: string[];
  factors: { rated: number; total: number };
}

export function tradeReviewState(userId: string, tradeId: string): TradeReviewState | null {
  const T = schema.trades, A = schema.aiAnalysis;
  const trade = db.select({ status: T.status, setupScore: T.setupScore, setupQuality: T.setupQuality, updatedAt: T.updatedAt }).from(T).where(and(eq(T.id, tradeId), eq(T.userId, userId))).get();
  if (!trade) return null;
  const rows = db.select().from(A).where(and(eq(A.userId, userId), eq(A.tradeId, tradeId), eq(A.kind, "trade_review"))).orderBy(desc(A.createdAt), desc(A.id)).limit(20).all();
  let good: TradeReviewState["good"] = null, unreadable = false;
  for (const r of rows) {
    if (r.status !== "ok") continue;
    const review = parseStoredReview(r.output);
    if (review) { good = { row: r, review }; break; }
    unreadable = true;
  }
  const mistakeKeys = db.select({ k: schema.tradeMistakes.mistakeKey }).from(schema.tradeMistakes).where(and(eq(schema.tradeMistakes.tradeId, tradeId), eq(schema.tradeMistakes.userId, userId))).all().map((r) => r.k);
  const total = db.select({ id: schema.scoreFactors.id }).from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, userId)).all().length;
  const rated = db.select({ id: schema.tradeFactorRatings.id }).from(schema.tradeFactorRatings).where(and(eq(schema.tradeFactorRatings.tradeId, tradeId), eq(schema.tradeFactorRatings.userId, userId))).all().length;
  return {
    good, unreadable,
    lastError: rows[0]?.status === "error" ? rows[0] : null,
    outOfDate: !!good && trade.updatedAt.getTime() > good.row.createdAt.getTime(),
    trade, mistakeKeys, factors: { rated, total },
  };
}

// ───────────── accepting a suggested mistake ─────────────

/**
 * Adds a mistake suggested by the latest review to the trade. The key must be a known mistake and
 * part of that review; the note is taken from the stored review, never from the request. Stored with
 * source "user" because refreshRuleMistakes() replaces every non-user row on each re-evaluation.
 */
export function addSuggestedMistake(userId: string, tradeId: string, key: string): { ok: boolean; message: string } {
  if (typeof key !== "string" || !Object.hasOwn(MISTAKE_LABEL, key)) return { ok: false, message: "Unknown mistake type." };
  const state = tradeReviewState(userId, tradeId);
  if (!state) throw new NotFoundError("Trade not found");
  const s = state.good?.review.suggestedMistakes.find((x) => x.key === key);
  if (!s) return { ok: false, message: "That suggestion isn't part of the latest review." };
  if (state.mistakeKeys.includes(key)) return { ok: true, message: `"${MISTAKE_LABEL[key]}" is already on this trade.` };
  const note = `Suggested by AI review: ${s.evidence} (your words: "${s.quote}")`.slice(0, 600);
  db.insert(schema.tradeMistakes).values({ id: newId(), tradeId, userId, mistakeKey: key, source: "user", note }).onConflictDoNothing().run();
  refreshRuleMistakes(userId, tradeId);
  return { ok: true, message: `Added "${MISTAKE_LABEL[key]}" to this trade.` };
}
