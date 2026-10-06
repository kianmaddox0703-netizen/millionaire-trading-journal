import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeAnthropic } from "./aiFake";
import { BASIS_HELP, BASIS_LABEL, REDACTION } from "@/domain/ai/guard";
import * as RD from "@/domain/ai/review";
import * as PD from "@/domain/ai/period";

// Isolated database per test run; no real key, so only the labelled test double (FakeAnthropic) can answer.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-ai-review-"));
process.env.DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_MODEL;

type Mods = {
  db: typeof import("@/server/db");
  trades: typeof import("@/server/trades");
  validation: typeof import("@/domain/validation");
  ids: typeof import("@/server/ids");
  analytics: typeof import("@/server/analytics");
  client: typeof import("@/server/ai/client");
  review: typeof import("@/server/ai/review");
  period: typeof import("@/server/ai/periodSummary");
  domainReview: typeof import("@/domain/review");
};
let m: Mods;
let A: string, B: string, acctA: string, acctB: string, stratA: string, setupA: string;
let tA: string, tB: string, tPlain: string;
let fake: FakeAnthropic;

function makeUser(email: string) {
  const id = m.ids.newId();
  m.db.db.insert(m.db.schema.users).values({ id, email, passwordHash: "x", timezone: "UTC" }).run();
  m.trades.bootstrapUser(id);
  const acct = m.db.db.select().from(m.db.schema.accounts).all().find((a) => a.userId === id)!;
  return { id, acct: acct.id };
}

function save(userId: string, accountId: string, over: Record<string, unknown> = {}) {
  return m.trades.saveTrade(userId, m.validation.tradeInput.parse({
    accountId, strategyId: userId === A ? stratA : null, setupId: userId === A ? setupA : null,
    symbol: "EURUSD", direction: "long", status: "closed", timeframe: "1H", setupQuality: "A", htfBias: "bullish",
    openedAt: "2026-03-04T08:30:00Z", closedAt: "2026-03-04T12:00:00Z",
    entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, exitPrice: 1.0845, grossPnl: 200, riskAmount: 100, ...over,
  }));
}

const esc = (s: string) => s.replace(/'/g, "&#x27;");
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const rows = (where: { tradeId?: string; kind?: string; userId?: string }) =>
  m.db.db.select().from(m.db.schema.aiAnalysis).all().filter((r) => (!where.tradeId || r.tradeId === where.tradeId) && (!where.kind || r.kind === where.kind) && (!where.userId || r.userId === where.userId));

/** SYNTHETIC model output, shaped like the structured output the real model is asked for. */
function reviewOut(over: Partial<RD.ReviewModelOutput> = {}): RD.ReviewModelOutput {
  const sim = m.review.reviewPacketFor(A, tA).similarity;
  return {
    headline: "You followed most of the plan but entered late.",
    wentWell: [{ text: "Risk stayed within your 1% limit.", basis: "data" }, { text: "The entry sits at a drawn zone.", basis: "chart" }],
    issues: [{ text: "Your note says you chased the breakout candle.", basis: "data" }],
    planCheck: [{ id: "R1", status: "followed", evidence: "Higher-timeframe bias: bullish and the trade is long." }, { id: "R99", status: "broken", evidence: "an id the app never sent" }],
    historicalComparison: { text: `${sim.n} similar earlier trades won ${(sim.winRate! * 100).toFixed(0)}% of the time at an average of ${sim.avgR!.toFixed(2)}R (n=${sim.n}). This describes past trades, not this one.` },
    suggestedMistakes: [
      { key: "late_entry", quote: "chased the breakout candle", evidence: "Your note describes entering after the trigger." },
      { key: "fomo", quote: "I felt invincible today", evidence: "Quote that is not in the records." },
      { key: "moved_stop", quote: "Entered late", evidence: "Already tagged on the trade." },
    ],
    lesson: { text: "Wait for the retest candle to close before entering." },
    ...over,
  };
}

/** SYNTHETIC model output for a period summary. */
const periodOut = (over: Partial<PD.PeriodModelOutput> = {}): PD.PeriodModelOutput => ({
  summary: "A small week with mixed results.",
  performance: [{ text: "EURUSD made up most trades (n=2).", basis: "history" }],
  process: [{ text: "You marked one trade as not following the plan.", basis: "data" }],
  psychology: [{ text: "Excitement appeared before the late entry.", basis: "inference" }],
  keep: [{ text: "Keep waiting for the retest.", basis: "opinion" }],
  stop: [{ text: "Stop chasing breakout candles.", basis: "opinion" }],
  change: [{ text: "Write the entry trigger before the session.", basis: "opinion" }],
  focus: { text: "One focus: enter only after the retest closes." },
  comparison: [{ text: "More trades than last month.", basis: "history" }],
  caveats: ["Only one setup was traded."],
  ...over,
});

beforeAll(async () => {
  m = {
    db: await import("@/server/db"),
    trades: await import("@/server/trades"),
    validation: await import("@/domain/validation"),
    ids: await import("@/server/ids"),
    analytics: await import("@/server/analytics"),
    client: await import("@/server/ai/client"),
    review: await import("@/server/ai/review"),
    period: await import("@/server/ai/periodSummary"),
    domainReview: await import("@/domain/review"),
  };
  ({ id: A, acct: acctA } = makeUser("rev-a@test.local"));
  ({ id: B, acct: acctB } = makeUser("rev-b@test.local"));
  const S = m.db.schema;
  stratA = m.db.db.select().from(S.strategies).all().find((s) => s.userId === A)!.id;
  setupA = m.db.db.select().from(S.setups).all().find((s) => s.userId === A && s.name === "Pullback to AOI")!.id;
  m.db.db.update(S.riskRules).set({ maxRiskPct: 1, minRr: 2 }).where(eq(S.riskRules.userId, A)).run();

  // 12 earlier trades with the same characteristics, alternating win/loss, in February
  for (let i = 0; i < 12; i++) {
    const d = String(2 + i).padStart(2, "0");
    save(A, acctA, { openedAt: `2026-02-${d}T08:30:00Z`, closedAt: `2026-02-${d}T12:00:00Z`, ...(i % 2 ? { exitPrice: 1.0815, grossPnl: -100 } : {}) });
  }
  tA = save(A, acctA, {
    notes: { why: "I chased the breakout candle because I was afraid to miss the move", didPoorly: "Entered late, well after the retest" },
    psych: { confidence: 8, followedPlan: false }, emotions: { before: "excitement" }, mistakes: ["moved_stop"],
    factors: { market_context: 2, htf_bias: 1 }, checklist: [{ phase: "pre", item: "Price at AOI", checked: true, answer: null }],
  });
  tPlain = save(A, acctA, { openedAt: "2026-03-05T08:30:00Z", closedAt: "2026-03-05T12:00:00Z" });
  tB = save(B, acctB, { symbol: "GBPJPY", openedAt: "2026-03-03T08:30:00Z", closedAt: "2026-03-03T12:00:00Z", notes: { why: "B-PRIVATE-NOTE-XYZ" } });

  // SYNTHETIC screenshot analyses (rows as the screenshot feature stores them): one for A's trade with one malformed field, one for B's trade
  for (const [userId, tradeId, summary] of [[A, tA, "Long position at a drawn zone on EURUSD."], [B, tB, "B-PRIVATE-SCREENSHOT"]] as const) {
    const imageId = m.ids.newId();
    m.db.db.insert(S.tradeImages).values({ id: imageId, tradeId, userId, kind: "entry", storageKey: "synthetic", thumbKey: "synthetic", mime: "image/png", width: 10, height: 10, bytes: 1 }).run();
    m.db.db.insert(S.aiAnalysis).values({ id: m.ids.newId(), userId, tradeId, imageId, kind: "screenshot", model: "fake", status: "ok", createdAt: new Date("2026-03-04T13:00:00Z"),
      output: JSON.stringify({ summary, observed: ["A long position tool is drawn from 1.0825."], inferred: "not-an-array", unknown: ["Higher timeframe isn't shown."], strategyFit: { overall: "partly", summary: "Some rules can't be seen." } }) }).run();
  }
  // SYNTHETIC market context rows (as the market-data feature stores them): current for tA, stale for tPlain
  const inputFor = (id: string, patch: Record<string, unknown> = {}) => {
    const t = m.db.db.select().from(S.trades).where(eq(S.trades.id, id)).get()!;
    return JSON.stringify({ v: 1, input: { symbol: t.symbol, openedAt: t.openedAt.toISOString(), entryPrice: t.entryPrice, ...patch }, computed: null });
  };
  m.db.db.insert(S.marketContext).values({ tradeId: tA, userId: A, provider: "oanda", instrument: "EUR_USD", trend: "bullish", htfBias: "bullish", session: "London", volatility: "normal", atr: 0.0012, nearKeyLevel: true, status: "ok", details: inputFor(tA) }).run();
  m.db.db.insert(S.marketContext).values({ tradeId: tPlain, userId: A, provider: "oanda", instrument: "EUR_USD", trend: "STALE-TREND", status: "ok", details: inputFor(tPlain, { entryPrice: 1.5 }) }).run();
});

beforeEach(() => {
  fake = new FakeAnthropic();
  m.client.setAiClientForTests(fake.asClient());
  m.client.resetAiQuotaForTests();
});
afterEach(() => m.client.setAiClientForTests(null));

describe("trade review packet", () => {
  it("contains the record, notes and the app's similarity statistics, and nothing of another user", () => {
    const p = m.review.reviewPacketFor(A, tA);
    const all = m.analytics.loadTrades(A, "UTC");
    const t = all.find((x) => x.id === tA)!;
    const expected = m.domainReview.reviewTrade(t, all.filter((x) => x.accountId === t.accountId), m.trades.getRiskRules(A));
    expect(expected.similarity.stat!.n).toBe(12);
    expect(p.similarity.n).toBe(12);
    expect(p.similarity.strength).toBe(expected.similarity.stat!.strength);
    expect(p.text).toContain("Similar earlier trades: n=12 (6 wins, 6 losses, 0 breakeven)");
    expect(p.text).toContain(`Win rate of similar trades: ${(expected.similarity.stat!.winRate! * 100).toFixed(1)}%`);
    expect(p.text).toContain("Evidence strength: Weak evidence (n=12)");
    expect(p.text).toContain("I chased the breakout candle because I was afraid to miss the move");
    expect(p.text).toContain("Emotion before: excitement");
    expect(p.text).toContain("Followed plan: no");
    expect(p.text).toContain("Pre-trade: [x] Price at AOI");
    expect(p.text).toContain("moved_stop (Moved stop loss), tagged by you");
    expect(p.text).toContain("App-computed setup score from your factor ratings");
    expect(p.text).toContain("Observed: A long position tool is drawn from 1.0825.");
    expect(p.text).not.toContain("not-an-array"); // a malformed stored field is skipped
    expect(p.text).toContain("Computed by the app from oanda H1 candles");
    // context computed before the trade was edited is left out rather than presented as market data
    expect(m.review.reviewPacketFor(A, tPlain).text).not.toContain("STALE-TREND");
    // plan: the strategy's rules plus the user's risk rules
    expect(p.planItems.find((x) => x.id === "R1")!.rule).toBe("Trade in the direction of the higher-timeframe trend");
    expect(p.planItems.filter((x) => x.group === "risk").map((x) => x.rule)).toEqual(["Risk at most 1% of the account per trade", "Planned reward:risk of at least 1:2"]);
    // isolation
    for (const s of ["B-PRIVATE-NOTE-XYZ", "GBPJPY", "B-PRIVATE-SCREENSHOT", tB]) expect(p.text).not.toContain(s);
    expect(() => m.review.reviewPacketFor(B, tA)).toThrow(m.trades.NotFoundError);
  });

  it("verifies quotes against the trader's own records and numbers against the statistics", () => {
    const p = m.review.reviewPacketFor(A, tA);
    expect(RD.quoteFound("“chased the breakout candle”", p.corpus)).toBe(true);
    expect(RD.quoteFound("I chased ... afraid to miss the move", p.corpus)).toBe(true);
    expect(RD.quoteFound("Followed plan: no", p.corpus)).toBe(true);
    expect(RD.quoteFound("I felt invincible today", p.corpus)).toBe(false);
    expect(RD.quoteFound("ok", p.corpus)).toBe(false);
    const allowed = RD.historyNumbers(p.similarity);
    expect(p.similarity.avgR).toBeCloseTo(0.5, 6); // 6 × 2R and 6 × −1R
    expect(RD.numbersAllowed("12 similar trades won 50% at +0.50R (median 0.5R); your baseline is 50.0%.", allowed)).toBe(true);
    expect(RD.numbersAllowed("12 similar trades won 50% at +0.43R.", allowed)).toBe(false);
    expect(RD.numbersAllowed("12 similar trades won 73% of the time.", allowed)).toBe(false);
    expect(RD.numbersAllowed("12 similar trades averaged −0.50R.", allowed)).toBe(false);
    expect(RD.numbersAllowed("12 similar trades averaged -0.5R.", allowed)).toBe(false);
    expect(RD.numbersAllowed("A 50-50 split over 12 trades.", allowed)).toBe(true);
  });
});

describe("trade review generation", () => {
  it("keeps the trader's own rule text as written; the certainty guard applies to what the AI wrote", () => {
    const p = m.review.reviewPacketFor(A, tA);
    const own = "Move SL to breakeven at 1R so the trade is risk-free.";
    const packet = { ...p, planItems: [{ ...p.planItems[0], rule: own }, ...p.planItems.slice(1)] };
    const r = RD.finalizeReview(reviewOut({ headline: "This trade will win." }) as never, packet, "test");
    expect(r.planCheck[0].rule).toBe(own);
    expect(r.headline).toBe(REDACTION);
    expect(r.redactions).toBe(1);
  });

  it("sends one structured request with the shared system prefix and stores a checked, scrubbed review", async () => {
    fake.push({ parsed: reviewOut({ headline: "Clean execution. This trade will win again next time.", lesson: { text: "Your setup quality was 9/10, so size up." } }) });
    const r = await m.review.generateTradeReview(A, tA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const req = fake.requests[0] as Record<string, any>;
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.max_tokens).toBe(16000);
    expect(req.output_config.effort).toBe("medium");
    expect(req.output_config.format.type).toBe("json_schema");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(expect.arrayContaining(["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"]));
    expect(req).not.toHaveProperty("thinking");
    expect(req).not.toHaveProperty("tool_choice");
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[0].content).toBe(m.review.reviewPacketFor(A, tA).text);
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.system[1].text).toBe(m.review.REVIEW_INSTRUCTIONS);

    const v = r.review;
    expect(v.headline).toContain(REDACTION);
    expect(v.headline).not.toMatch(/will win/);
    expect(v.redactions).toBe(1);
    expect(v.lesson).toEqual({ text: expect.stringContaining("[score removed"), basis: "opinion" });
    expect(v.wentWell.map((x) => x.basis)).toEqual(["data", "chart"]); // chart allowed: a screenshot reading was in the packet
    expect(v.historicalComparison).toMatchObject({ source: "ai", n: 12, strength: "weak", basis: "history" });
    expect(v.planCheck.find((x) => x.id === "R1")!.status).toBe("followed");
    expect(v.planCheck.some((x) => x.id === "R99")).toBe(false);
    expect(v.planCheck.find((x) => x.id === "R2")).toMatchObject({ status: "not_recorded", evidence: "Not assessed in this review." });
    expect(v.planCheck.filter((x) => x.group === "risk")).toHaveLength(2);
    expect(v.suggestedMistakes.map((x) => x.key)).toEqual(["late_entry"]); // fomo quote not found; moved_stop already tagged
    expect(v.droppedSuggestions).toBe(1);

    const row = rows({ tradeId: tA, kind: "trade_review" }).find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ userId: A, status: "ok", model: "claude-opus-5-5", inputTokens: 100, outputTokens: 50 });
    expect(RD.parseStoredReview(row.output)).toEqual(v);
  });

  it("replaces a historical comparison with invented numbers by the app's own wording, and downgrades chart claims without screenshots", async () => {
    fake.push({ parsed: reviewOut({ historicalComparison: { text: "Setups like this win 81% of the time." }, suggestedMistakes: [] }) });
    const r = await m.review.generateTradeReview(A, tPlain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.review.historicalComparison.source).toBe("app");
    expect(r.review.historicalComparison.text).toContain("not this one");
    expect(r.review.historicalComparison.text).not.toContain("81%");
    expect(r.review.wentWell[1].basis).toBe("inference"); // no screenshot reading for this trade
  });

  it("accepts other spellings of enum values (the SDK sends enums as a hint, not a constraint)", async () => {
    const out = reviewOut() as unknown as Record<string, any>;
    out.wentWell = [{ text: "Risk within limit.", basis: "Your records" }, { text: "Similar trades did fine.", basis: "Historical evidence" }, { text: "Odd label.", basis: "fact" }];
    out.planCheck = [{ id: "R1", status: "met", evidence: "Bias bullish, long." }, { id: "R2", status: "Not recorded", evidence: "Nothing on the AOI." }];
    out.suggestedMistakes = [{ key: "Late Entry", quote: "chased the breakout candle", evidence: "Entered after the trigger." }, { key: "bad_key", quote: "x", evidence: "y" }];
    fake.push({ parsed: out });
    const r = await m.review.generateTradeReview(A, tPlain);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.review.wentWell.map((x) => x.basis)).toEqual(["data", "history", "inference"]);
    expect(r.review.planCheck.slice(0, 2).map((x) => x.status)).toEqual(["followed", "not_recorded"]);
    expect(r.review.suggestedMistakes).toEqual([]); // late_entry's quote is from another trade's notes, so it isn't in this trade's records
    expect(r.review.droppedSuggestions).toBe(1);
  });

  it("stores parse failures, schema mismatches, refusals, truncation and API errors as error rows", async () => {
    const cases: [Parameters<FakeAnthropic["push"]>[0], RegExp][] = [
      [{ content: [{ type: "text", text: "not json" }] }, /expected format/],
      [{ parsed: { headline: 5 } }, /expected structure/],
      [{ content: [], stop_reason: "refusal" }, /declined/],
      [{ content: [{ type: "text", text: "{\"headline\": \"cut" }], stop_reason: "max_tokens" }, /cut off/],
      [{ error: new Anthropic.APIConnectionError({ message: "socket hang up" }) }, /Couldn't reach the Anthropic API/],
    ];
    for (const [turn, msg] of cases) {
      fake.push(turn);
      const r = await m.review.generateTradeReview(A, tPlain);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toMatch(msg);
      const row = rows({ tradeId: tPlain }).find((x) => x.id === r.id)!;
      expect(row).toMatchObject({ status: "error", kind: "trade_review", output: "" });
      expect(row.error).toMatch(msg);
    }
    const state = m.review.tradeReviewState(A, tPlain)!;
    expect(state.lastError).not.toBeNull();
    expect(state.good).not.toBeNull(); // the earlier good review is still shown
  });

  it("refuses without a key, for open trades and for other users' trades, without storing anything", async () => {
    const before = rows({}).length;
    m.client.setAiClientForTests(null);
    await expect(m.review.generateTradeReview(A, tA)).rejects.toBeInstanceOf(m.client.AiNotConfiguredError);
    m.client.setAiClientForTests(fake.asClient());
    const open = save(A, acctA, { status: "open", closedAt: null, exitPrice: null, grossPnl: null });
    await expect(m.review.generateTradeReview(A, open)).rejects.toBeInstanceOf(m.review.ReviewInputError);
    await expect(m.review.generateTradeReview(B, tA)).rejects.toBeInstanceOf(m.trades.NotFoundError);
    expect(fake.requests).toHaveLength(0);
    expect(rows({}).length).toBe(before);
  });

  it("marks a review out of date when the trade changes afterwards", () => {
    expect(m.review.tradeReviewState(A, tA)!.outOfDate).toBe(false);
    m.db.db.update(m.db.schema.trades).set({ updatedAt: new Date(Date.now() + 60_000) }).where(eq(m.db.schema.trades.id, tA)).run();
    expect(m.review.tradeReviewState(A, tA)!.outOfDate).toBe(true);
    expect(m.review.tradeReviewState(B, tA)).toBeNull();
    m.db.db.update(m.db.schema.trades).set({ updatedAt: new Date("2026-03-04T12:00:00Z") }).where(eq(m.db.schema.trades.id, tA)).run();
  });
});

describe("automatic review after a save", () => {
  const recent = (over: Record<string, unknown> = {}) => save(A, acctA, { openedAt: hoursAgo(3), closedAt: hoursAgo(1), ...over });

  it("marks a claimed trade as being written until its review is done, so no second review is offered", async () => {
    const t = recent();
    const claimed = m.review.claimAutoReviews(A, [t], "manual");
    expect(claimed).toEqual([t]);
    expect(m.review.reviewBeingWritten(t)).toBe(true);
    expect(m.review.claimAutoReviews(A, [t], "manual")).toEqual([]); // not claimed twice
    fake.push({ parsed: reviewOut({ suggestedMistakes: [] }) });
    await m.review.runClaimedReviews(A, claimed);
    expect(m.review.reviewBeingWritten(t)).toBe(false);
    expect(rows({ tradeId: t, kind: "trade_review" })).toHaveLength(1);
  });

  it("reviews a newly closed trade once, and skips open trades", async () => {
    const closed = recent(), open = save(A, acctA, { status: "open", openedAt: hoursAgo(2), closedAt: null, exitPrice: null, grossPnl: null });
    fake.push({ parsed: reviewOut({ suggestedMistakes: [] }) });
    await m.review.autoReviewTrades(A, [closed, open], "manual");
    expect(fake.requests).toHaveLength(1);
    expect(rows({ tradeId: closed, kind: "trade_review" })).toHaveLength(1);
    expect(rows({ tradeId: open })).toHaveLength(0);
    await m.review.autoReviewTrades(A, [closed], "manual");
    await m.review.autoReviewTrades(A, [closed], "mt5_bridge");
    expect(fake.requests).toHaveLength(1);
    expect(rows({ tradeId: closed, kind: "trade_review" })).toHaveLength(1);
  });

  it("skips file imports, users who turned it off, and servers without a key", async () => {
    const t = recent();
    await m.review.autoReviewTrades(A, [t], "import");
    m.db.db.update(m.db.schema.users).set({ aiAutoReview: false }).where(eq(m.db.schema.users.id, A)).run();
    await m.review.autoReviewTrades(A, [t], "manual");
    m.db.db.update(m.db.schema.users).set({ aiAutoReview: true }).where(eq(m.db.schema.users.id, A)).run();
    m.client.setAiClientForTests(null);
    await m.review.autoReviewTrades(A, [t], "manual");
    expect(fake.requests).toHaveLength(0);
    expect(rows({ tradeId: t })).toHaveLength(0);
  });

  it("from MT5 sync only reviews recently closed trades, at most five per save, and never throws", async () => {
    const old = save(A, acctA, { openedAt: "2026-01-05T08:30:00Z", closedAt: "2026-01-05T12:00:00Z" });
    const fresh = Array.from({ length: 7 }, () => recent());
    for (let i = 0; i < 7; i++) fake.push({ parsed: reviewOut({ suggestedMistakes: [] }) });
    await m.review.autoReviewTrades(A, [old, ...fresh], "mt5_bridge");
    expect(fake.requests).toHaveLength(m.review.AUTO_MAX_PER_SAVE);
    expect(rows({ tradeId: old })).toHaveLength(0);
    // a failing call is stored as an error row and doesn't throw; unknown and foreign ids are ignored
    const failing = recent();
    fake = new FakeAnthropic().push({ error: new Error("synthetic failure") });
    m.client.setAiClientForTests(fake.asClient());
    await expect(m.review.autoReviewTrades(A, [failing, "does-not-exist", tB], "manual")).resolves.toBeUndefined();
    expect(rows({ tradeId: failing })[0]).toMatchObject({ status: "error" });
    expect(rows({ tradeId: tB, kind: "trade_review" })).toHaveLength(0);
  });
});

describe("suggested mistakes", () => {
  it("validates the key, the owner and the latest review, then adds a user mistake that survives rule refreshes", () => {
    expect(m.review.addSuggestedMistake(A, tA, "not_a_mistake")).toMatchObject({ ok: false });
    expect(m.review.addSuggestedMistake(A, tA, "__proto__")).toMatchObject({ ok: false });
    expect(() => m.review.addSuggestedMistake(B, tA, "late_entry")).toThrow(m.trades.NotFoundError);
    expect(m.review.addSuggestedMistake(A, tA, "revenge")).toMatchObject({ ok: false }); // not suggested by the latest review

    expect(m.review.addSuggestedMistake(A, tA, "late_entry")).toMatchObject({ ok: true });
    const M = m.db.schema.tradeMistakes;
    const get = () => m.db.db.select().from(M).where(and(eq(M.tradeId, tA), eq(M.mistakeKey, "late_entry"))).get();
    expect(get()).toMatchObject({ userId: A, source: "user" });
    expect(get()!.note).toMatch(/^Suggested by AI review: Your note describes entering after the trigger\. \(your words: "chased the breakout candle"\)/);
    m.trades.refreshRuleMistakes(A, tA);
    expect(get()).toBeTruthy();
    expect(m.review.addSuggestedMistake(A, tA, "late_entry")).toMatchObject({ ok: true, message: expect.stringContaining("already") });
    expect(m.db.db.select().from(M).where(and(eq(M.tradeId, tA), eq(M.mistakeKey, "late_entry"))).all()).toHaveLength(1);
  });

  it("renders basis badges and hides suggestions already on the trade", async () => {
    const { AiReviewView } = await import("@/components/ai/AiReviewView");
    const s = m.review.tradeReviewState(A, tA)!;
    const meta = { model: "claude-opus-5-5", at: "now", inputTokens: 1, outputTokens: 1 };
    const add = (key: string) => h("button", null, `Add ${key}`);
    const before = renderToStaticMarkup(h(AiReviewView, { r: s.good!.review, existingKeys: [], addAction: add, meta }));
    expect(before).toContain("Add late_entry");
    expect(before).toContain(`>${BASIS_LABEL.history}<`);
    expect(before).toContain(`title="${esc(BASIS_HELP.opinion)}"`);
    expect(before).toContain("Weak evidence · n=12");
    const after = renderToStaticMarkup(h(AiReviewView, { r: s.good!.review, existingKeys: s.mistakeKeys, addAction: add, meta }));
    expect(after).not.toContain("Add late_entry");
  });
});

describe("period summaries", () => {
  const W = "2026-03-02";

  it("stores a weekly summary under <Monday>|<scope> from this user's data, without touching the written review", async () => {
    const WR = m.db.schema.weeklyReviews;
    m.db.db.insert(WR).values({ id: m.ids.newId(), userId: A, weekStart: W, keepDoing: "Waiting for the retest", focusNextWeek: "Only A setups" }).run();
    const before = m.db.db.select().from(WR).where(eq(WR.userId, A)).get();
    fake.push({ parsed: periodOut({ summary: "You will win next week if you keep this up." }) });
    const r = await m.period.generatePeriodSummary(A, "weekly", W);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = rows({ kind: "weekly" }).find((x) => x.id === r.id)!;
    expect(row).toMatchObject({ userId: A, periodKey: `${W}|all`, status: "ok", tradeId: null });
    const text = String((fake.requests[0] as { messages: { content: string }[] }).messages[0].content);
    expect(text).toContain("[What should I continue?]\nWaiting for the retest");
    expect(text).toContain("This week: trades 2");
    expect(text).toContain("I chased the breakout candle");
    expect(text).not.toContain("GBPJPY");
    expect(text).not.toContain("B-PRIVATE-NOTE-XYZ");
    expect(r.summary.summary).toContain(REDACTION);
    expect(r.summary.comparison).toEqual([]); // weekly: no month comparison
    expect(r.summary.focus.basis).toBe("opinion");
    expect(r.summary.caveats[0]).toMatch(/^2 closed trades this week: an insufficient sample/);
    // the AI's own caveat is kept apart from the app's sample-size caveats
    expect(r.summary.caveats).not.toContain("Only one setup was traded.");
    expect(r.summary.aiCaveats).toContain("Only one setup was traded.");
    expect(m.db.db.select().from(WR).where(eq(WR.userId, A)).get()).toEqual(before);
    expect(PD.parseStoredPeriod(row.output)).toEqual(r.summary);

    const st = m.period.periodSummaryState(A, "weekly", W);
    expect(st.good?.row.id).toBe(r.id);
    expect(st.outOfDate).toBe(false);
    m.db.db.update(m.db.schema.trades).set({ updatedAt: new Date(Date.now() + 60_000) }).where(eq(m.db.schema.trades.id, tPlain)).run();
    expect(m.period.periodSummaryState(A, "weekly", W).outOfDate).toBe(true);
    m.db.db.update(m.db.schema.trades).set({ updatedAt: new Date("2026-03-05T12:00:00Z") }).where(eq(m.db.schema.trades.id, tPlain)).run();
    expect(m.period.periodSummaryState(B, "weekly", W).good).toBeNull();
  });

  it("scopes the key to the selected account and refuses another user's account", async () => {
    fake.push({ parsed: periodOut() });
    const r = await m.period.generatePeriodSummary(A, "weekly", W, acctA);
    expect(r.ok && rows({ kind: "weekly" }).find((x) => x.id === r.id)!.periodKey).toBe(`${W}|${acctA}`);
    await expect(m.period.generatePeriodSummary(A, "weekly", W, acctB)).rejects.toBeInstanceOf(m.trades.NotFoundError);
    expect(fake.requests).toHaveLength(1);
  });

  it("stores a monthly summary with the previous month's statistics in the packet", async () => {
    fake.push({ parsed: periodOut() });
    const r = await m.period.generatePeriodSummary(A, "monthly", "2026-03");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(rows({ kind: "monthly" }).find((x) => x.id === r.id)!.periodKey).toBe("2026-03|all");
    const text = String((fake.requests[0] as { messages: { content: string }[] }).messages[0].content);
    expect(text).toContain("<previous_month>\nPrevious month: trades 12 (6 wins, 6 losses, 0 breakeven)");
    expect(text).toContain("<earlier_months>\n2026-02: trades 12");
    expect(r.summary.comparison).toHaveLength(1);
  });

  it("rejects invalid or empty periods before calling the API, and stores API failures", async () => {
    await expect(m.period.generatePeriodSummary(A, "weekly", "2026-03-03")).rejects.toBeInstanceOf(m.period.PeriodInputError); // not a Monday
    await expect(m.period.generatePeriodSummary(A, "monthly", "2026-13")).rejects.toBeInstanceOf(m.period.PeriodInputError);
    await expect(m.period.generatePeriodSummary(A, "weekly", "2025-06-02")).rejects.toThrow(/No closed trades/);
    expect(fake.requests).toHaveLength(0);
    fake.push({ content: [], stop_reason: "refusal" });
    const r = await m.period.generatePeriodSummary(A, "monthly", "2026-02");
    expect(r.ok).toBe(false);
    expect(rows({ kind: "monthly" }).find((x) => x.id === r.id)).toMatchObject({ status: "error", periodKey: "2026-02|all" });
    expect(m.period.periodSummaryState(A, "monthly", "2026-02").lastError).not.toBeNull();
  });

  it("renders every point with its basis badge", async () => {
    const { AiPeriodView } = await import("@/components/ai/AiPeriodView");
    const s = m.period.periodSummaryState(A, "monthly", "2026-03").good!.summary;
    const html = renderToStaticMarkup(h(AiPeriodView, { s, meta: { model: "claude-opus-5-5", at: "now", inputTokens: 1, outputTokens: 1 } }));
    for (const b of ["history", "data", "inference", "opinion"] as const) expect(html).toContain(`title="${esc(BASIS_HELP[b])}"`);
    expect(html).toContain("Compared with previous months");
    expect(html).toContain("Suggested focus for next month");
  });
});
