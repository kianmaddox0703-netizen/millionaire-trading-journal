import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeAnthropic, type FakeTurn } from "./aiFake";
import { REDACTION } from "@/domain/ai/guard";
import * as D from "@/domain/ai/coach";

// Isolated database per test run; no real key, so only the labelled test double can answer.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-ai-coach-"));
process.env.DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_MODEL;

type Mods = {
  db: typeof import("@/server/db");
  trades: typeof import("@/server/trades");
  validation: typeof import("@/domain/validation");
  ids: typeof import("@/server/ids");
  client: typeof import("@/server/ai/client");
  coach: typeof import("@/server/ai/coach");
  tools: typeof import("@/server/ai/coachTools");
  view: typeof import("@/components/ai/CoachMessage");
  ask: typeof import("@/components/ai/AskCoachLink");
};
let m: Mods;
let A: string, B: string, acctA: string, acctB: string;
let fake: FakeAnthropic;
const tradeIdA: Record<number, string> = {};

function makeUser(email: string) {
  const id = m.ids.newId();
  m.db.db.insert(m.db.schema.users).values({ id, email, passwordHash: "x", timezone: "UTC" }).run();
  m.trades.bootstrapUser(id);
  const acct = m.db.db.select().from(m.db.schema.accounts).all().find((a) => a.userId === id)!;
  return { id, acct: acct.id };
}

/** SYNTHETIC FIXTURE: made-up trades, notes and reviews; marker strings let the tests spot cross-user leaks. */
function seed() {
  const S = m.db.schema;
  const stratA = m.db.db.select().from(S.strategies).all().find((s) => s.userId === A)!.id;
  for (let i = 0; i < 12; i++) {
    const day = String(2 + i).padStart(2, "0");
    const win = i % 3 !== 0;
    const id = m.trades.saveTrade(A, m.validation.tradeInput.parse({
      accountId: acctA, strategyId: i < 8 ? stratA : null, symbol: "EURUSD", direction: "long", status: "closed", timeframe: "15m", setupQuality: i % 2 ? "A" : "B",
      openedAt: `2026-03-${day}T08:30:00Z`, closedAt: `2026-03-${day}T12:00:00Z`,
      entryPrice: 1.08, initialStop: 1.079, takeProfit: 1.083, exitPrice: win ? 1.082 : 1.079, grossPnl: win ? 200 : -100, riskAmount: 100,
      notes: i === 0 ? { why: "A-NOTE-MARKER clean retest" } : {}, emotions: { before: i % 2 ? "calm" : "fomo" }, psych: { confidence: 3 + (i % 7), followedPlan: win },
      mistakes: win ? [] : ["late_entry"], checklist: i === 0 ? [{ phase: "pre", item: "Price at AOI", checked: true, answer: null }] : [],
    }));
    tradeIdA[i + 1] = id;
  }
  const stratB = m.ids.newId();
  m.db.db.insert(S.strategies).values({ id: stratB, userId: B, name: "B Secret Strategy" }).run();
  for (let i = 0; i < 15; i++) {
    const day = String(2 + i).padStart(2, "0");
    m.trades.saveTrade(B, m.validation.tradeInput.parse({
      accountId: acctB, strategyId: stratB, symbol: "GBPJPY", direction: "short", status: "closed", timeframe: "1H",
      openedAt: `2026-03-${day}T13:30:00Z`, closedAt: `2026-03-${day}T15:00:00Z`,
      entryPrice: 190, initialStop: 190.5, takeProfit: 189, exitPrice: 189.5, grossPnl: 300, riskAmount: 100,
      notes: { why: "SECRET-B-NOTE" }, emotions: { before: "greed" }, mistakes: ["revenge"],
    }));
  }
  const bTrade = m.db.db.select().from(S.trades).all().find((t) => t.userId === B && t.seq === 14)!;
  m.db.db.insert(S.weeklyReviews).values({ id: m.ids.newId(), userId: B, weekStart: "2026-03-02", keepDoing: "SECRET-B-REVIEW" }).run();
  m.db.db.insert(S.weeklyReviews).values({ id: m.ids.newId(), userId: A, weekStart: "2026-03-02", focusNextWeek: "A-REVIEW-MARKER wait for the retest" }).run();
  m.db.db.insert(S.aiAnalysis).values({ id: m.ids.newId(), userId: B, tradeId: bTrade.id, kind: "trade_review", model: "test", output: JSON.stringify({ summary: "SECRET-B-AI" }) }).run();
  m.db.db.insert(S.aiAnalysis).values({ id: m.ids.newId(), userId: B, kind: "weekly", periodKey: "2026-03-02|all", model: "test", output: JSON.stringify({ summary: "SECRET-B-AI-WEEK" }) }).run();
  m.db.db.insert(S.aiAnalysis).values({ id: m.ids.newId(), userId: A, tradeId: tradeIdA[1], kind: "trade_review", model: "test", output: JSON.stringify({ summary: "A-AI-REVIEW" }) }).run();
  // SYNTHETIC market context rows, computed for the trades as they are now
  const current = (id: string) => {
    const t = m.db.db.select().from(S.trades).all().find((x) => x.id === id)!;
    return JSON.stringify({ v: 1, input: { symbol: t.symbol, openedAt: t.openedAt.toISOString(), entryPrice: t.entryPrice }, computed: null });
  };
  m.db.db.insert(S.marketContext).values({ tradeId: bTrade.id, userId: B, provider: "test", trend: "SECRET-B-TREND", status: "ok", details: current(bTrade.id) }).run();
  m.db.db.insert(S.marketContext).values({ tradeId: tradeIdA[1], userId: A, provider: "test", trend: "bullish", status: "ok", details: current(tradeIdA[1]) }).run();
}

const LEAK = /GBPJPY|SECRET-B|B Secret Strategy/;

async function collect(gen: AsyncGenerator<D.CoachEvent>) {
  const out: D.CoachEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
const textTurn = (text: string, over: Partial<FakeTurn> = {}): FakeTurn => ({ content: [{ type: "text", text }], ...over });
const toolTurn = (...calls: [string, string, unknown][]): FakeTurn => ({ content: calls.map(([id, name, input]) => ({ type: "tool_use" as const, id, name, input })) });
type Req = { model: string; max_tokens: number; tool_choice: unknown; tools: { name: string; strict?: boolean; input_schema: Record<string, unknown> }[]; output_config: unknown; messages: { role: string; content: unknown }[] } & Record<string, unknown>;
const req = (i: number) => fake.requests[i < 0 ? fake.requests.length + i : i] as unknown as Req;
type Block = { type: string; text?: string; content?: string; is_error?: boolean; tool_use_id?: string; cache_control?: unknown };
const blocks = (content: unknown) => content as Block[];
const messagesOf = (conversationId: string) => m.db.db.select().from(m.db.schema.coachMessages).all().filter((x) => x.conversationId === conversationId);
const conversations = (userId: string) => m.db.db.select().from(m.db.schema.coachConversations).all().filter((x) => x.userId === userId);
const post = (body: unknown) => new Request("http://localhost/api/ai/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  m = {
    db: await import("@/server/db"),
    trades: await import("@/server/trades"),
    validation: await import("@/domain/validation"),
    ids: await import("@/server/ids"),
    client: await import("@/server/ai/client"),
    coach: await import("@/server/ai/coach"),
    tools: await import("@/server/ai/coachTools"),
    view: await import("@/components/ai/CoachMessage"),
    ask: await import("@/components/ai/AskCoachLink"),
  };
  ({ id: A, acct: acctA } = makeUser("coach-a@test.local"));
  ({ id: B, acct: acctB } = makeUser("coach-b@test.local"));
  seed();
});

beforeEach(() => {
  fake = new FakeAnthropic();
  m.client.setAiClientForTests(fake.asClient());
  m.client.resetAiQuotaForTests();
});
afterEach(() => m.client.setAiClientForTests(null));

// ───────────── tools ─────────────

const INPUTS: Record<string, unknown> = {
  get_performance: { conditions: [] },
  breakdown: { dimension: "symbol", conditions: [] },
  list_trades: { conditions: [], sort: "pnl", order: "desc", limit: 20 },
  get_trade: { seq: 1 },
  compare_to_history: { seq: 12 },
  find_edges: { conditions: [] },
  mistakes: { conditions: [] },
  psychology: { conditions: [] },
  strategies: {},
  reviews: { kind: "weekly", limit: 12 },
  risk_rules: {},
  search_methodology: { query: "break and retest" },
};

describe("coach tools", () => {
  it("are strict, closed JSON schemas without numeric or length constraints", () => {
    expect(Object.keys(INPUTS).sort()).toEqual([...m.tools.COACH_TOOL_NAMES].sort());
    for (const t of m.tools.COACH_TOOLS) {
      expect(t.strict).toBe(true);
      const walk = (v: unknown) => {
        if (!v || typeof v !== "object") return;
        const o = v as Record<string, unknown>;
        if (o.type === "object") expect(o.additionalProperties).toBe(false);
        for (const k of ["minimum", "maximum", "minLength", "maxLength", "$schema"]) expect(o).not.toHaveProperty(k);
        Object.values(o).forEach(walk);
      };
      walk(t.input_schema);
    }
  });

  it("only ever return the signed-in user's data", () => {
    const dA = new m.tools.CoachData(A, "UTC");
    for (const [name, input] of Object.entries(INPUTS)) {
      const r = m.tools.runCoachTool(dA, name, input);
      expect(r.isError, `${name}: ${r.content}`).toBe(false);
      expect(r.content, name).not.toMatch(LEAK);
    }
    for (const kind of ["weekly", "monthly"]) expect(m.tools.runCoachTool(dA, "reviews", { kind, limit: 12 }).content).not.toMatch(LEAK);
    const t1 = m.tools.runCoachTool(dA, "get_trade", { seq: 1 }).content;
    expect(t1).toContain("A-NOTE-MARKER");
    expect(t1).toContain("A-AI-REVIEW");
    expect(t1).toContain("Price at AOI");
    expect(m.tools.runCoachTool(dA, "reviews", { kind: "weekly", limit: 3 }).content).toContain("A-REVIEW-MARKER");
    // B owns trade #14; A has 12 trades, so the number doesn't resolve to anything for A
    const missing = m.tools.runCoachTool(dA, "get_trade", { seq: 14 });
    expect(missing.isError).toBe(true);
    expect(missing.content).toMatch(/no trade #14/);
    // a symbol only B trades is unknown to A, and the error lists only A's symbols
    const sym = m.tools.runCoachTool(dA, "list_trades", { conditions: [{ field: "symbol", value: "GBPJPY" }], sort: "date", order: "desc", limit: 5 });
    expect(sym.isError).toBe(true);
    expect(JSON.parse(sym.content).error).toBe('No trades with symbol "GBPJPY". Values in the journal: EURUSD.');

    // the same lookups for B do show B's data, so the checks above aren't vacuous
    const dB = new m.tools.CoachData(B, "UTC");
    expect(m.tools.runCoachTool(dB, "get_trade", { seq: 14 }).content).toMatch(/SECRET-B-NOTE[\s\S]*SECRET-B-AI[\s\S]*SECRET-B-TREND/);
    expect(m.tools.runCoachTool(dB, "strategies", {}).content).toContain("B Secret Strategy");
    expect(m.tools.runCoachTool(dB, "reviews", { kind: "weekly", limit: 3 }).content).toMatch(/SECRET-B-REVIEW[\s\S]*SECRET-B-AI-WEEK/);
  });

  it("compute from the journal: counts, filters, sorting and sample-size labels", () => {
    const dA = new m.tools.CoachData(A, "UTC");
    const perf = JSON.parse(m.tools.runCoachTool(dA, "get_performance", { conditions: [] }).content);
    expect(perf.closed.n).toBe(12);
    expect(perf.closed.wins).toBe(8);
    expect(perf.sample).toMatch(/Weak evidence/);
    expect(perf.verdict).toMatch(/Not enough trades/); // under 20 trades: no edge claimed
    const best = JSON.parse(m.tools.runCoachTool(dA, "list_trades", { conditions: [{ field: "outcome", value: "win" }], sort: "r", order: "desc", limit: 500 }).content);
    expect(best.matched).toBe(8);
    expect(best.trades.length).toBe(8);
    expect(best.trades.every((t: { r: number }) => t.r > 0)).toBe(true);
    const capped = JSON.parse(m.tools.runCoachTool(dA, "list_trades", { conditions: [], sort: "date", order: "asc", limit: 500 }).content);
    expect(capped.trades.length).toBeLessThanOrEqual(20);
    expect(capped.trades[0].seq).toBe(1);
    const strat = JSON.parse(m.tools.runCoachTool(dA, "get_performance", { conditions: [{ field: "strategy", value: "fxalexg set & forget" }, { field: "weekday", value: "Monday" }] }).content);
    expect(strat.applied).toEqual(["strategy=fxalexg set & forget", "weekday=Monday"]);
    expect(strat.matched).toBe(2); // March 2 and 9 are Mondays, both on the strategy
    const by = JSON.parse(m.tools.runCoachTool(dA, "breakdown", { dimension: "quality", conditions: [] }).content);
    expect(by.rows.map((r: { value: string; n: number }) => [r.value, r.n]).sort()).toEqual([["A", 6], ["B", 6]]);
    expect(by.rows[0].evidence).toBe("Insufficient sample");
    const mis = JSON.parse(m.tools.runCoachTool(dA, "mistakes", { conditions: [] }).content);
    expect(mis.mistakes[0]).toMatchObject({ mistake: "Entered late", count: 4 });
    const cmp = JSON.parse(m.tools.runCoachTool(dA, "compare_to_history", { seq: 12 }).content);
    expect(cmp.note).toMatch(/not a prediction/);
    expect(cmp.baseline.n).toBe(11);
    expect(cmp.traits.find((t: { trait: string }) => t.trait === "Symbol").winnersWithIt).toBe("7 of 7") // 7 of the 11 earlier trades won;
    const kb = JSON.parse(m.tools.runCoachTool(dA, "search_methodology", { query: "break and retest" }).content);
    expect(kb.matches[0].slug).toBe("break-and-retest");
    expect(kb.matches[0].confidence).toBeTruthy();
  });

  it("turn invalid input into error results instead of running", () => {
    const dA = new m.tools.CoachData(A, "UTC");
    const cases: [string, unknown, RegExp][] = [
      ["list_trades", { conditions: [], sort: "random", order: "desc", limit: 5 }, /Invalid input: sort/],
      ["list_trades", { conditions: [], sort: "date", order: "desc", limit: 5, userId: B }, /Invalid input/],
      ["get_trade", { seq: "1; DROP TABLE trades" }, /Invalid input: seq/],
      ["get_performance", { conditions: [{ field: "from", value: "last week" }] }, /YYYY-MM-DD/],
      ["get_performance", { conditions: [{ field: "symbol", value: "EURUSD" }, { field: "symbol", value: "EURUSD" }] }, /more than once/],
      ["get_performance", { conditions: [{ field: "account", value: "Someone else's account" }] }, /No trades with account/],
      ["get_performance", { conditions: [{ field: "session", value: "Frankfurt" }] }, /Unknown session "Frankfurt". Use one of: Sydney/],
      ["search_methodology", { query: "the and" }, /no searchable words/],
      ["delete_everything", {}, /Unknown tool/],
    ];
    for (const [name, input, re] of cases) {
      const r = m.tools.runCoachTool(dA, name, input);
      expect(r.isError, name).toBe(true);
      expect(JSON.parse(r.content).error).toMatch(re);
    }
  });
});

// ───────────── the loop ─────────────

describe("coach loop", () => {
  it("runs tool_use → tool_result → answer, streams it and stores both messages", async () => {
    const thinking = { type: "thinking" as const, thinking: "", signature: "sig-1" };
    const call1 = toolTurn(["tu_1", "get_performance", { conditions: [] }], ["tu_2", "list_trades", { conditions: [], sort: "r", order: "desc", limit: 3 }]);
    call1.content!.unshift(thinking);
    fake.push(call1, textTurn("You closed **12** trades (n=12, weak evidence) [History]. Your best was #2; #99 isn't yours.", { usage: { input_tokens: 300, output_tokens: 80 } }));
    const events = await collect(m.coach.runCoach(A, { conversationId: null, message: "How am I doing?" }));

    expect(events[0].type).toBe("conversation");
    expect(events.filter((e) => e.type === "status").map((e) => (e as { text: string }).text)).toEqual(["Checking your performance…", "Looking at your trades…"]);
    const streamed = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(streamed).toContain("You closed **12** trades");
    expect(events.some((e) => e.type === "replace")).toBe(false);
    const done = events[events.length - 1] as Extract<D.CoachEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.links).toEqual({ 2: tradeIdA[2] });
    expect(done.tools).toEqual(["get_performance", "list_trades"]);

    // request shape follows the API rules
    const r1 = req(0);
    expect(r1.model).toBe("claude-opus-5-5");
    expect(r1.max_tokens).toBe(16000);
    expect(r1.tool_choice).toEqual({ type: "auto" });
    expect(r1.output_config).toEqual({ effort: "medium" });
    expect(r1).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(r1).not.toHaveProperty("thinking");
    expect(r1.tools.every((t) => t.strict === true)).toBe(true);
    const first = blocks(r1.messages[0].content);
    expect(first[0].text).toMatch(/^<app_context>[\s\S]*Today: \w{3} \d{4}-\d{2}-\d{2}/);
    expect(first[1].text).toBe("How am I doing?");

    // the assistant turn goes back unchanged (thinking included); all results in one user message
    const r2 = req(1);
    expect(r2.messages[1]).toEqual({ role: "assistant", content: call1.content });
    const results = blocks(r2.messages[2].content);
    expect(results.map((b) => [b.type, b.tool_use_id, b.is_error])).toEqual([["tool_result", "tu_1", undefined], ["tool_result", "tu_2", undefined]]);
    expect(JSON.parse(results[0].content!).closed.n).toBe(12);
    expect(results.map((b) => b.content).join("")).not.toMatch(LEAK);
    expect(results[1].cache_control).toEqual({ type: "ephemeral" });

    const conv = (events[0] as { id: string }).id;
    const stored = messagesOf(conv).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(stored.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(stored[0].content).toBe("How am I doing?");
    expect(stored[1]).toMatchObject({ content: streamed, tools: "get_performance,list_trades", model: "claude-opus-5-5", inputTokens: 400, outputTokens: 130 });
    expect(m.coach.loadConversation(A, conv)!.links).toEqual({ 2: tradeIdA[2] });
    expect(m.db.db.select().from(m.db.schema.aiAnalysis).all().some((r) => r.userId === A && r.kind === "coach" && r.status === "ok" && r.output.includes(conv))).toBe(true);

    // a follow-up sends the earlier turns back as plain text
    fake.push(textTurn("Focus on waiting for the retest [Opinion]."));
    const ev2 = await collect(m.coach.runCoach(A, { conversationId: conv, message: "What next week?" }));
    expect(ev2[ev2.length - 1].type).toBe("done");
    const r3 = req(-1);
    expect(r3.messages.slice(0, 2)).toEqual([{ role: "user", content: "How am I doing?" }, { role: "assistant", content: streamed }]);
    expect(blocks(r3.messages[2].content)[1].text).toBe("What next week?");
    expect(messagesOf(conv)).toHaveLength(4);
  });

  it("returns invalid tool input and unknown tools to the model as is_error results", async () => {
    fake.push(
      toolTurn(["tu_bad", "list_trades", { conditions: [], sort: "random", order: "desc", limit: 5 }], ["tu_x", "drop_tables", {}]),
      textTurn("I couldn't sort that way [Data]."),
    );
    const events = await collect(m.coach.runCoach(A, { conversationId: null, message: "Sort my trades randomly" }));
    expect(events[events.length - 1].type).toBe("done");
    const results = blocks(req(1).messages[2].content);
    expect(results.map((b) => b.is_error)).toEqual([true, true]);
    expect(results[0].content).toMatch(/Invalid input/);
    expect(results[1].content).toMatch(/Unknown tool/);
  });

  it("never streams a certainty claim and stores the scrubbed text", async () => {
    fake.push(textTurn("This trade will win. London has n=12 (weak evidence) [History]."));
    const events = await collect(m.coach.runCoach(A, { conversationId: null, message: "Will my trade win?" }));
    const shown = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(shown).toContain(REDACTION);
    expect(shown).not.toMatch(/will win/);
    expect(events.some((e) => e.type === "replace")).toBe(false);
    const conv = (events[0] as { id: string }).id;
    expect(messagesOf(conv).find((x) => x.role === "assistant")!.content).toBe(shown);
  });

  it("stops a runaway loop after 8 tool rounds", async () => {
    const before = conversations(A).length;
    for (let i = 0; i < 9; i++) fake.push(toolTurn([`tu_${i}`, "get_performance", { conditions: [] }]));
    const events = await collect(m.coach.runCoach(A, { conversationId: null, message: "Loop forever" }));
    expect(fake.requests).toHaveLength(9);
    expect(req(7).tool_choice).toEqual({ type: "auto" });
    expect(req(8).tool_choice).toEqual({ type: "none" });
    expect(blocks(req(8).messages[req(8).messages.length - 1].content).at(-1)!.text).toMatch(/Lookup limit reached/);
    const last = events[events.length - 1] as { type: string; message: string };
    expect(last).toMatchObject({ type: "error" });
    expect(last.message).toMatch(/too many lookups/);
    expect(conversations(A)).toHaveLength(before); // nothing stored for a failed answer
    expect(m.db.db.select().from(m.db.schema.aiAnalysis).all().some((r) => r.userId === A && r.kind === "coach" && r.status === "error")).toBe(true);

    // with the cap reached, an answer on the forced no-tools call still completes
    fake = new FakeAnthropic();
    m.client.setAiClientForTests(fake.asClient());
    m.client.resetAiQuotaForTests();
    for (let i = 0; i < 8; i++) fake.push(toolTurn([`tu_${i}`, "get_performance", { conditions: [] }]));
    fake.push(textTurn("Here is what I found [History]."));
    const ok = await collect(m.coach.runCoach(A, { conversationId: null, message: "Dig deep" }));
    expect(ok[ok.length - 1].type).toBe("done");
    expect(fake.requests).toHaveLength(9);
  });

  it("turns a refusal or an API failure into an error event and stores nothing", async () => {
    const before = conversations(A).length;
    fake.push(textTurn("Partial", { stop_reason: "refusal" }));
    const refused = await collect(m.coach.runCoach(A, { conversationId: null, message: "Something odd" }));
    expect(refused[refused.length - 1]).toEqual({ type: "error", message: "The model declined to answer this request." });

    fake.push({ error: new Anthropic.APIConnectionError({ message: "socket hang up" }) });
    const failed = await collect(m.coach.runCoach(A, { conversationId: null, message: "Hello" }));
    expect(failed[failed.length - 1]).toEqual({ type: "error", message: "Couldn't reach the Anthropic API. Check the server's network access." });
    expect(conversations(A)).toHaveLength(before);
  });
});

// ───────────── HTTP handler and ownership ─────────────

describe("coach requests", () => {
  it("enforce sign-in, the length cap, configuration and the rate limit", async () => {
    expect((await m.coach.handleCoachRequest(null, post({ message: "hi" }))).status).toBe(401);
    const long = await m.coach.handleCoachRequest({ id: A }, post({ message: "x".repeat(D.MAX_MESSAGE_CHARS + 1) }));
    expect(long.status).toBe(400);
    expect((await long.json()).error).toMatch(/2000 characters/);
    expect((await m.coach.handleCoachRequest({ id: A }, post({ message: "   " }))).status).toBe(400);
    expect((await m.coach.handleCoachRequest({ id: A }, post({ message: "hi", conversationId: "../x" }))).status).toBe(400);
    expect(m.coach.validateCoachInput(A, { message: "x".repeat(D.MAX_MESSAGE_CHARS) }).ok).toBe(true);
    expect(fake.requests).toHaveLength(0);

    m.client.setAiClientForTests(null);
    const off = await m.coach.handleCoachRequest({ id: A }, post({ message: "hi" }));
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ code: "not_configured", error: m.coach.NOT_CONFIGURED });
    m.client.setAiClientForTests(fake.asClient());

    for (let i = 0; i < 40; i++) m.client.takeAiQuota(A);
    const limited = await m.coach.handleCoachRequest({ id: A }, post({ message: "hi" }));
    expect(limited.status).toBe(429);
    expect(fake.requests).toHaveLength(0);
  });

  it("streams NDJSON events", async () => {
    fake.push(textTurn("Your best trade was #3 [History]."));
    const res = await m.coach.handleCoachRequest({ id: A }, post({ message: "Show me my best trade." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as D.CoachEvent);
    expect(events.map((e) => e.type)).toEqual(["conversation", ...events.slice(1, -1).map(() => "text"), "done"]);
    expect((events[events.length - 1] as { links: Record<string, string> }).links).toEqual({ 3: tradeIdA[3] });
  });

  it("stores nothing when the browser disconnects mid-answer", async () => {
    const before = conversations(A).length;
    fake.push(textTurn("A long answer that the browser never finishes reading [History]."));
    const res = await m.coach.handleCoachRequest({ id: A }, post({ message: "Disconnect test" }));
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.split("\n")[0]).type).toBe("conversation");
    expect(conversations(A)).toHaveLength(before + 1);
    await reader.cancel();
    expect(conversations(A)).toHaveLength(before);
  });

  it("never lets one user read, continue or delete another user's conversation", async () => {
    fake.push(textTurn("B's answer [History]."));
    const evB = await collect(m.coach.runCoach(B, { conversationId: null, message: "SECRET-B question" }));
    const convB = (evB[0] as { id: string }).id;
    expect(messagesOf(convB)).toHaveLength(2);

    expect(m.coach.validateCoachInput(A, { message: "hi", conversationId: convB })).toEqual({ ok: false, status: 404, error: "Conversation not found." });
    const res = await m.coach.handleCoachRequest({ id: A }, post({ message: "hi", conversationId: convB }));
    expect(res.status).toBe(404);
    const direct = await collect(m.coach.runCoach(A, { conversationId: convB, message: "hi" }));
    expect(direct).toEqual([{ type: "error", message: "Conversation not found." }]);
    expect(fake.requests).toHaveLength(1); // only B's own question reached the API
    expect(m.coach.loadConversation(A, convB)).toBeNull();
    expect(m.coach.listConversations(A).some((c) => c.id === convB)).toBe(false);
    expect(m.coach.deleteConversation(A, convB)).toBe(false);
    expect(messagesOf(convB)).toHaveLength(2);
    expect(m.coach.loadConversation(B, convB)!.messages).toHaveLength(2);
    expect(m.coach.tradeLinksFor(A, [14, 15])).toEqual({}); // B's trade numbers don't link for A
    expect(m.coach.deleteConversation(B, convB)).toBe(true);
    expect(conversations(B).some((c) => c.id === convB)).toBe(false);
  });
});

// ───────────── rendering and helpers ─────────────

describe("coach rendering", () => {
  it("parses answers into safe blocks", () => {
    const blocks = D.parseAnswer("Lead **answer** [history].\n\n- one #3\n- two `#4`\n  continued\n\n1. first\n2. second\n\n## Heading\n| a | b |\n|---|---|");
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "ol", "h", "pre"]);
    expect(blocks[0]).toEqual({ t: "p", c: [{ t: "text", v: "Lead " }, { t: "strong", c: [{ t: "text", v: "answer" }] }, { t: "text", v: " " }, { t: "basis", basis: "history" }, { t: "text", v: "." }] });
    expect(D.tradeRefs("See #3 and #12, not `#4`, abc#5 or &#6;")).toEqual([3, 12]);
    expect(D.parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "[x](javascript:alert(1))" }]);
  });

  it("renders without injecting HTML and links only known trades", () => {
    const html = renderToStaticMarkup(h(m.view.CoachMessage, {
      text: "<script>alert(1)</script> **+0.40R** [History] #2 #99 [src](https://fxalexg.com/) [bad](javascript:alert(1)) [report](https://attacker.example/r?d=winrate)",
      links: { 2: "TRADE2" },
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong");
    expect(html).toContain("Historical evidence");
    expect(html).toContain('href="/trades/TRADE2"');
    expect(html).not.toContain("/trades/undefined");
    expect(html).toContain('href="https://fxalexg.com/"');
    expect(html).not.toMatch(/href="javascript/);
    // a URL that isn't one of the knowledge base's sources stays visible but isn't a link
    expect(html).not.toContain('href="https://attacker.example');
    expect(html).toContain("report (https://attacker.example/r?d=winrate)");
  });

  it("reads NDJSON split across chunks and labels tool calls", () => {
    const r = new D.NdjsonReader();
    expect(r.push('{"type":"text","delta":"Hel')).toEqual([]);
    expect(r.push('lo"}\n{"type":"status","text":"x"}\n{"ty')).toEqual([{ type: "text", delta: "Hello" }, { type: "status", text: "x" }]);
    expect(r.push('pe":"done","messageId":"m","links":{},"tools":[]}')).toEqual([]);
    expect(r.flush()).toEqual([{ type: "done", messageId: "m", links: {}, tools: [] }]);
    expect(D.toolStatus("get_trade", { seq: 7 })).toBe("Reading trade #7…");
    expect(D.toolStatus("breakdown", { dimension: "session" })).toBe("Breaking down your results by session…");
    expect(D.tradeQuestion(5)).toBe("Is trade #5 consistent with my plan? Compare it to my historical winners.");
  });

  it("shows Ask coach only when AI is configured", () => {
    expect(renderToStaticMarkup(h(m.ask.AskCoachLink, { tradeId: "T1", seq: 5 }))).toMatch(/href="\/coach\?trade=T1"[\s\S]*Ask coach/);
    m.client.setAiClientForTests(null);
    expect(renderToStaticMarkup(h(m.ask.AskCoachLink, { tradeId: "T1", seq: 5 }))).toBe("");
  });
});
