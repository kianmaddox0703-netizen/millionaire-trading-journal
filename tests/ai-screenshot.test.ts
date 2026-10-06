import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FakeAnthropic } from "./aiFake";
import { REDACTION } from "@/domain/ai/guard";
import * as D from "@/domain/ai/screenshot";

// Isolated database + uploads per test run; no real key, so only the labelled test double can answer.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-ai-shot-"));
process.env.DATA_DIR = dir;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_MODEL;

type Mods = {
  db: typeof import("@/server/db");
  trades: typeof import("@/server/trades");
  validation: typeof import("@/domain/validation");
  ids: typeof import("@/server/ids");
  storage: typeof import("@/server/storage");
  client: typeof import("@/server/ai/client");
  prompts: typeof import("@/server/ai/prompts");
  shot: typeof import("@/server/ai/screenshot");
};
let m: Mods;
let A: string, B: string, acctA: string, acctB: string, stratA: string;
let fake: FakeAnthropic;

function makeUser(email: string) {
  const id = m.ids.newId();
  m.db.db.insert(m.db.schema.users).values({ id, email, passwordHash: "x", timezone: "UTC" }).run();
  m.trades.bootstrapUser(id);
  const acct = m.db.db.select().from(m.db.schema.accounts).all().find((a) => a.userId === id)!;
  return { id, acct: acct.id };
}

/** SYNTHETIC FIXTURE: a flat-colour PNG standing in for a chart screenshot (no real chart content). */
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#131722" } }).png().toBuffer();

async function tradeWithImage(userId: string, accountId: string, strategyId: string | null, img: Buffer) {
  const tradeId = m.trades.saveTrade(userId, m.validation.tradeInput.parse({
    accountId, strategyId, symbol: "EURUSD", direction: "long", status: "closed", timeframe: "15m",
    openedAt: "2026-03-03T08:30:00Z", closedAt: "2026-03-03T12:00:00Z",
    entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, exitPrice: 1.0845, grossPnl: 200, riskAmount: 100,
  }));
  const stored = await m.storage.storeImage(userId, img);
  const imageId = m.ids.newId();
  m.db.db.insert(m.db.schema.tradeImages).values({ id: imageId, tradeId, userId, kind: "entry", caption: "", sort: 0, ...stored }).run();
  return { tradeId, imageId };
}

const r = <V>(value: V, status: D.ReadingStatus, evidence: string) => ({ value, status, evidence });
/** SYNTHETIC model output, shaped like the structured output the real model is asked for. */
const modelOutput = (over: Partial<D.AnalysisModelOutput> = {}): D.AnalysisModelOutput => ({
  chartSource: "tradingview",
  fields: {
    symbol: r("EURUSD", "observed", "Chart header, top left"),
    timeframe: r("5", "observed", "Interval button in the header"),
    direction: r("long", "inferred", "Position tool colours suggest long"),
    entry: r(1.0825, "observed", "Position tool entry label"),
    stop: r(1.0815, "observed", "Red zone lower label"),
    takeProfit: r(1.0855, "observed", "Green zone upper label"),
  },
  observed: ["A long position tool is drawn from 1.0825."],
  inferred: ["Price appears to be making higher lows on this timeframe."],
  unknown: ["Higher-timeframe context isn't shown."],
  structure: [{ aspect: "trend", note: "Higher highs and higher lows across the visible range.", basis: "inferred" }],
  strategyRules: [{ id: "R1", status: "not_visible", evidence: "Only one timeframe is shown." }, { id: "R2", status: "met", evidence: "Entry sits at a drawn zone." }],
  strategySummary: "One required rule is met and the rest can't be seen.",
  discrepancies: [
    { topic: "Session", chart: "Candles near 14:00 on the time axis", record: "Opened 08:30 UTC", basis: "inferred" },
    { topic: "Entry price", chart: "1.0830", record: "1.0825", basis: "observed" },
  ],
  summary: "A long position at a drawn zone on EURUSD.",
  ...over,
});

const rows = () => m.db.db.select().from(m.db.schema.aiAnalysis).all();

beforeAll(async () => {
  m = {
    db: await import("@/server/db"),
    trades: await import("@/server/trades"),
    validation: await import("@/domain/validation"),
    ids: await import("@/server/ids"),
    storage: await import("@/server/storage"),
    client: await import("@/server/ai/client"),
    prompts: await import("@/server/ai/prompts"),
    shot: await import("@/server/ai/screenshot"),
  };
  ({ id: A, acct: acctA } = makeUser("shot-a@test.local"));
  ({ id: B, acct: acctB } = makeUser("shot-b@test.local"));
  stratA = m.db.db.select().from(m.db.schema.strategies).all().find((s) => s.userId === A)!.id;
});

beforeEach(() => {
  fake = new FakeAnthropic();
  m.client.setAiClientForTests(fake.asClient());
  m.client.resetAiQuotaForTests();
});
afterEach(() => m.client.setAiClientForTests(null));

describe("vision sizing", () => {
  it("matches the documented resize reference examples", () => {
    expect(D.resizedSize(1075, 1520, 1568, 1568)).toEqual([924, 1307]);
    expect(D.resizedSize(1920, 1080, 1568, 1568)).toEqual([1456, 819]);
    expect(D.resizedSize(3840, 2160, 2576, 4784)).toEqual([2576, 1449]);
    expect(D.resizedSize(1920, 1080, 2576, 4784)).toEqual([1920, 1080]);
  });

  it("puts Claude 4.7+ on the high-resolution tier and older ids on the standard tier", () => {
    for (const id of ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-7", "claude-sonnet-5-5", "claude-fable-5-1", "anthropic.claude-opus-5-5", "some-future-id"]) expect(D.visionTier(id)).toBe("high");
    for (const id of ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-sonnet-4-20250514", "claude-opus-4-1-20250805", "claude-3-5-sonnet-20241022"]) expect(D.visionTier(id)).toBe("standard");
  });

  it("sends fitting images byte-for-byte and downsizes large ones to the API's own target size", async () => {
    const small = await png(1280, 720);
    const a = await m.shot.prepareImageForVision(small, "claude-opus-5-5");
    expect(a.resized).toBe(false);
    expect(a.block.source).toEqual({ type: "base64", media_type: "image/png", data: small.toString("base64") });

    const big = await png(4000, 2250);
    const b = await m.shot.prepareImageForVision(big, "claude-opus-5-5");
    expect([b.sentWidth, b.sentHeight]).toEqual([2576, 1449]);
    const src = b.block.source as { media_type: string; data: string };
    expect(src.media_type).toBe("image/png");
    const meta = await sharp(Buffer.from(src.data, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([2576, 1449]);

    const jpg = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const c = await m.shot.prepareImageForVision(jpg, "claude-haiku-4-5");
    expect((c.block.source as { media_type: string }).media_type).toBe("image/jpeg");
    expect(Math.ceil(c.sentWidth / 28) * Math.ceil(c.sentHeight / 28)).toBeLessThanOrEqual(1568);

    await expect(m.shot.prepareImageForVision(Buffer.from("not an image at all"), "claude-opus-5-5")).rejects.toThrow(/JPEG, PNG and WebP/);
  });
});

describe("analyzeTradeImage", () => {
  it("sends the image block first, then the record as data, with the shared system blocks and structured output", async () => {
    const img = await png(1280, 720);
    const { imageId } = await tradeWithImage(A, acctA, stratA, img);
    fake.push({ parsed: modelOutput(), usage: { input_tokens: 2345, output_tokens: 678 } });
    const res = await m.shot.analyzeTradeImage(A, imageId);
    expect(res.ok).toBe(true);

    expect(fake.requests).toHaveLength(1);
    const body = fake.requests[0] as Record<string, any>;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(16000);
    expect(body.system).toEqual(m.prompts.systemBlocks(m.shot.ANALYZE_INSTRUCTIONS));
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(JSON.stringify(body.output_config.format.schema)).not.toContain("$ref");
    expect(body.fallbacks).toBe("default");
    expect(body.betas).toEqual(expect.arrayContaining(["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"]));
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("tool_choice");

    const content = body.messages[0].content;
    expect(body.messages).toHaveLength(1);
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: img.toString("base64") } });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("<trade_record>");
    // the recorded chart fields are withheld so a reading can't be copied from the record
    expect(content[1].text).toMatch(/withheld on purpose/);
    expect(content[1].text).not.toMatch(/Symbol: |Entry: |Stop loss: |Take profit: |1\.0825/);
    expect(content[1].text).toContain("R1 | rule | required | Trade in the direction of the higher-timeframe trend");
    // per-request data stays out of the system prompt (cache prefix)
    expect(JSON.stringify(body.system)).not.toMatch(/<trade_record>|Opened \(UTC\)|1\.0825/);
  });

  it("stores the result with app-computed R:R, record mismatches and strategy fit", async () => {
    const { imageId, tradeId } = await tradeWithImage(A, acctA, stratA, await png(1280, 720));
    fake.push({ parsed: modelOutput(), usage: { input_tokens: 2345, output_tokens: 678 } });
    const res = await m.shot.analyzeTradeImage(A, imageId);
    if (!res.ok) throw new Error(res.error);
    const row = rows().find((x) => x.id === res.id)!;
    expect(row).toMatchObject({ userId: A, tradeId, imageId, kind: "screenshot", status: "ok", model: "claude-opus-5-5", inputTokens: 2345, outputTokens: 678, error: null });
    const a = m.shot.parseStoredAnalysis(row.output)!;
    expect(a).not.toBeNull();
    expect(a.riskReward).toMatchObject({ value: 3, basis: "computed_from_visible_levels" });
    // timeframe "5" (chart) vs "15m" (record) is found by the app; the model's own entry remark is replaced by the app's check
    expect(a.discrepancies.filter((d) => d.source === "app").map((d) => d.topic)).toEqual(["Timeframe"]);
    expect(a.discrepancies.filter((d) => d.source === "ai").map((d) => d.topic)).toEqual(["Session"]);
    // rule text comes from the database, every rule is listed, unassessed ones are "not visible"
    const dbRules = m.db.db.select().from(m.db.schema.strategyRules).all().filter((x) => x.strategyId === stratA).sort((x, y) => x.sort - y.sort);
    expect(a.strategyFit.rules.map((x) => x.rule)).toEqual(dbRules.map((x) => x.text));
    expect(a.strategyFit.rules[1].status).toBe("met");
    expect(a.strategyFit.rules[5]).toMatchObject({ status: "not_visible", evidence: "Not assessed." });
    expect(a.strategyFit.overall).toBe("partly");
    expect(a.image).toEqual({ width: 1280, height: 720, sentWidth: 1280, sentHeight: 720 });

    const state = m.shot.screenshotAnalysesForTrade(A, tradeId);
    expect(state).toHaveLength(1);
    expect(state[0].good?.row.id).toBe(res.id);
  });

  it("scrubs certainty statements before storing", async () => {
    const { imageId } = await tradeWithImage(A, acctA, null, await png(800, 600));
    fake.push({ parsed: modelOutput({ summary: "This trade will win.", observed: ["Entry at the zone. This is a guaranteed winner."] }) });
    const res = await m.shot.analyzeTradeImage(A, imageId);
    if (!res.ok) throw new Error(res.error);
    const stored = m.shot.parseStoredAnalysis(rows().find((x) => x.id === res.id)!.output)!;
    expect(stored.summary).toBe(REDACTION);
    expect(stored.observed[0]).toBe(`Entry at the zone. ${REDACTION}`);
    expect(JSON.stringify(stored)).not.toMatch(/will win|guaranteed winner/);
    // no strategy on this trade → nothing to check
    expect(stored.strategyFit).toMatchObject({ strategy: null, overall: "cannot_tell", rules: [] });
  });

  it("keeps users apart: another user's screenshot is not found and nothing is sent or stored", async () => {
    const { imageId, tradeId } = await tradeWithImage(A, acctA, stratA, await png(800, 600));
    const before = rows().length;
    await expect(m.shot.analyzeTradeImage(B, imageId)).rejects.toThrow(m.trades.NotFoundError);
    const res = await m.shot.handleAnalyzeRequest({ id: B }, new Request("http://x/api/ai/screenshot/analyze", { method: "POST", body: JSON.stringify({ imageId }) }));
    expect(res.status).toBe(404);
    expect(fake.requests).toHaveLength(0);
    expect(rows().length).toBe(before);
    expect(m.shot.screenshotAnalysesForTrade(B, tradeId)).toEqual([]);
    void acctB;
  });

  it("stores a friendly error for a refusal and for a cut-off answer", async () => {
    const { imageId, tradeId } = await tradeWithImage(A, acctA, stratA, await png(800, 600));
    fake.push({ content: [{ type: "text", text: "I can't help with that." }], stop_reason: "refusal" });
    const r1 = await m.shot.analyzeTradeImage(A, imageId);
    expect(r1).toMatchObject({ ok: false, error: "The model declined to answer this request." });
    fake.push({ content: [{ type: "text", text: '{"chartSource":"tradingview","fields":{"symbol":' }], stop_reason: "max_tokens" });
    const r2 = await m.shot.analyzeTradeImage(A, imageId);
    expect(r2).toMatchObject({ ok: false, error: "The AI answer was cut off before it finished. Try again." });
    for (const r of [r1, r2]) expect(rows().find((x) => x.id === r.id)).toMatchObject({ status: "error", output: "", userId: A, imageId, kind: "screenshot" });

    const state = m.shot.screenshotAnalysesForTrade(A, tradeId)[0];
    expect(state.good).toBeNull();
    expect(state.lastError?.error).toBe("The AI answer was cut off before it finished. Try again.");
  });

  it("stores a friendly error for API failures and malformed answers, without leaking details", async () => {
    const { imageId } = await tradeWithImage(A, acctA, stratA, await png(800, 600));
    fake.push({ error: new Anthropic.APIConnectionError({ message: "socket hang up" }) });
    const r1 = await m.shot.analyzeTradeImage(A, imageId);
    expect(r1).toMatchObject({ ok: false, error: "Couldn't reach the Anthropic API. Check the server's network access." });
    fake.push({ parsed: { chartSource: "tradingview" } });
    const r2 = await m.shot.analyzeTradeImage(A, imageId);
    expect(r2).toMatchObject({ ok: false, error: "The AI answer didn't match the expected structure. Try again." });
    const res = await m.shot.handleAnalyzeRequest({ id: A }, new Request("http://x", { method: "POST", body: JSON.stringify({ imageId }) }).clone());
    // nothing queued → the double throws a plain Error, which must surface as a generic message
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The AI request failed.");
  });

  it("tolerates enum casing (the SDK passes enum lists to the model as descriptions)", async () => {
    const { imageId } = await tradeWithImage(A, acctA, stratA, await png(800, 600));
    const out = modelOutput();
    const loose = JSON.parse(JSON.stringify(out).replaceAll(':"observed"', ':"Observed"').replace('"tradingview"', '"TradingView"').replace('"long"', '"Long"').replace('"not_visible"', '"not visible"'));
    fake.push({ parsed: loose });
    const res = await m.shot.analyzeTradeImage(A, imageId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.analysis.chartSource).toBe("tradingview");
      expect(res.analysis.fields.direction.value).toBe("long");
      expect(res.analysis.fields.entry.status).toBe("observed");
    }
  });

  it("reports not configured calmly and stores nothing", async () => {
    const { imageId } = await tradeWithImage(A, acctA, stratA, await png(800, 600));
    m.client.setAiClientForTests(null);
    const before = rows().length;
    await expect(m.shot.analyzeTradeImage(A, imageId)).rejects.toThrow(m.client.AiNotConfiguredError);
    const res = await m.shot.handleAnalyzeRequest({ id: A }, new Request("http://x", { method: "POST", body: JSON.stringify({ imageId }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(rows().length).toBe(before);
  });

  it("requires auth and an image id", async () => {
    expect((await m.shot.handleAnalyzeRequest(null, new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await m.shot.handleAnalyzeRequest({ id: A }, new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("flags stored rows that no longer validate instead of showing them", async () => {
    const { imageId, tradeId } = await tradeWithImage(A, acctA, stratA, await png(800, 600));
    m.db.db.insert(m.db.schema.aiAnalysis).values({ id: m.ids.newId(), userId: A, tradeId, imageId, kind: "screenshot", model: "x", status: "ok", output: '{"old":true}', createdAt: new Date() }).run();
    const s = m.shot.screenshotAnalysesForTrade(A, tradeId)[0];
    expect(s).toMatchObject({ good: null, unreadable: true, lastError: null });
  });
});

describe("quick entry extract endpoint", () => {
  const post = (fd?: FormData) => new Request("http://x/api/ai/screenshot/extract", { method: "POST", body: fd ?? new FormData() });
  const withFile = (buf: Buffer, name = "chart.png", type = "image/png") => { const fd = new FormData(); fd.append("file", new File([new Uint8Array(buf)], name, { type })); return fd; };
  /** SYNTHETIC quick-entry model output. */
  const extractOut = () => ({
    chartSource: "mt5",
    fields: {
      symbol: r("EURUSD.r", "observed", "Window title"), timeframe: r("M15", "observed", "Window title"), direction: r("short", "inferred", "Sell line colour"),
      entry: r(1.0825, "observed", "Order line label"), stop: r(1.0835, "unknown", "Not shown"), takeProfit: r(null, "unknown", "No TP line visible"),
    },
    unknown: ["Higher-timeframe trend"],
  });

  it("requires auth, a file, an allowed type and the 15 MB limit", async () => {
    expect((await m.shot.handleExtractRequest(null, post(withFile(await png(10, 10))))).status).toBe(401);
    expect((await m.shot.handleExtractRequest({ id: A }, post())).status).toBe(400);
    expect((await m.shot.handleExtractRequest({ id: A }, post(withFile(Buffer.from("hello, not an image"), "x.png")))).status).toBe(415);
    const tooBig = Buffer.alloc(m.storage.MAX_IMAGE_BYTES + 1);
    expect((await m.shot.handleExtractRequest({ id: A }, post(withFile(tooBig)))).status).toBe(413);
    expect(fake.requests).toHaveLength(0);
  });

  it("returns cleaned readings without storing anything", async () => {
    const before = rows().length;
    fake.push({ parsed: extractOut() });
    const img = await png(1280, 720);
    const res = await m.shot.handleExtractRequest({ id: A }, post(withFile(img)));
    expect(res.status).toBe(200);
    const j = await res.json();
    const out = D.ScreenshotExtract.parse(j.result);
    expect(out.fields.symbol).toMatchObject({ value: "EURUSD.r", status: "observed" });
    expect(out.fields.stop).toMatchObject({ value: null, status: "unknown" }); // a value the model marked unknown is dropped
    expect(rows().length).toBe(before);
    const body = fake.requests[0] as Record<string, any>;
    expect(body.system).toEqual(m.prompts.systemBlocks(m.shot.EXTRACT_INSTRUCTIONS));
    expect(body.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: img.toString("base64") } });
  });

  it("reports refusals and missing configuration", async () => {
    fake.push({ content: [{ type: "text", text: "No." }], stop_reason: "refusal" });
    const r1 = await m.shot.handleExtractRequest({ id: A }, post(withFile(await png(64, 64))));
    expect(r1.status).toBe(502);
    expect((await r1.json()).error).toBe("The model declined to answer this request.");
    m.client.setAiClientForTests(null);
    const r2 = await m.shot.handleExtractRequest({ id: A }, post(withFile(await png(64, 64))));
    expect(r2.status).toBe(503);
    expect(await r2.json()).toMatchObject({ code: "not_configured", error: m.shot.NOT_CONFIGURED });
  });
});

describe("pure helpers", () => {
  it("never reads a monthly chart as one minute", () => {
    for (const tf of ["1M", "M", "MN1", "MN", "Monthly"]) expect(D.toFormTimeframe(tf)).toBeNull();
    expect(D.toFormTimeframe("1m")).toBe("1m");
    expect(D.toFormTimeframe("M15")).toBe("15m");
    expect(D.toFormTimeframe("15")).toBe("15m");
    expect(D.toFormTimeframe("H4")).toBe("4H");
  });

  it("maps enum synonyms and never promotes an unknown word to observed", () => {
    const out = D.normalizeEnums({
      chartSource: "MetaTrader 5",
      fields: { direction: { value: "Buy", status: "Visible on chart", evidence: "" }, symbol: { value: "EURUSD", status: "whatever", evidence: "" } },
      structure: [{ aspect: "Key levels", note: "", basis: "chart" }, { aspect: "indicators", note: "", basis: "made up" }],
      strategyRules: [{ id: "r1", status: "Not met", evidence: "" }, { id: "r2", status: "unknown", evidence: "" }],
    }) as Record<string, any>;
    expect(out.chartSource).toBe("mt5");
    expect(out.fields.direction).toEqual({ value: "long", status: "observed", evidence: "" });
    expect(out.fields.symbol.status).toBe("unknown");
    expect(out.structure.map((x: any) => [x.aspect, x.basis])).toEqual([["support_resistance", "observed"], ["other", "inferred"]]);
    expect(out.strategyRules.map((x: any) => x.status)).toEqual(["not_met", "not_visible"]);
  });

  const fields = (over: Partial<D.Fields> = {}): D.Fields => ({ ...modelOutput().fields, ...over });
  const empty: D.FormSnapshot = { symbol: "", direction: "long", entryPrice: "", initialStop: "", takeProfit: "", timeframe: "" };

  it("fills only empty fields, and only from observed readings", () => {
    const plan = D.fillPlan(D.cleanFields(fields(), "tradingview"), empty, false);
    const patch = D.patchFor(plan, plan.filter((x) => x.autoFill).map((x) => x.key));
    expect(patch).toEqual({ symbol: "EURUSD", timeframe: "5m", entryPrice: "1.0825", initialStop: "1.0815", takeProfit: "1.0855" });
    // inferred direction is offered per field, never auto-filled
    const dir = plan.find((x) => x.key === "direction")!;
    expect(dir).toMatchObject({ canUse: true, autoFill: false, formValue: "long" });
  });

  it("never overwrites what the trader typed or chose", () => {
    const typed = { ...empty, entryPrice: "1.0830", symbol: "GBPUSD", direction: "short" as const };
    const plan = D.fillPlan(D.cleanFields(fields({ direction: r("long", "observed", "label") }), "tradingview"), typed, true);
    const all = D.patchFor(plan, [...D.FIELD_KEYS]);
    expect(all).not.toHaveProperty("entryPrice");
    expect(all).not.toHaveProperty("symbol");
    expect(all).not.toHaveProperty("direction");
    expect(plan.find((x) => x.key === "entry")!.note).toBe("Form has 1.0830; left unchanged.");
  });

  it("maps chart timeframes to the form's options", () => {
    expect(["M15", "15", "15m", "H1", "60", "1h", "240", "H4", "D1", "1D", "Daily", "W", "1W", "M1", "30"].map(D.toFormTimeframe))
      .toEqual(["15m", "15m", "15m", "1H", "1H", "1H", "4H", "4H", "D", "D", "D", "W", "W", "1m", "30m"]);
    expect(D.toFormTimeframe("2H")).toBeNull();
    expect(D.toFormTimeframe("3m")).toBeNull();
  });

  it("computes R:R only from observed levels on consistent sides", () => {
    expect(D.riskRewardFromReadings(D.cleanFields(fields(), "tradingview")).value).toBe(3);
    expect(D.riskRewardFromReadings(D.cleanFields(fields({ stop: r(1.0815, "inferred", "between labels") }), "tradingview"))).toMatchObject({ value: null, basis: "unknown" });
    expect(D.riskRewardFromReadings(D.cleanFields(fields({ takeProfit: r(1.0800, "observed", "x") }), "tradingview")).value).toBeNull();
  });

  it("treats a non-chart as all unknown and allows for rounding on price labels", () => {
    const f = D.cleanFields(fields(), "not_a_chart");
    expect(D.FIELD_KEYS.every((k) => f[k].status === "unknown" && f[k].value === null)).toBe(true);
    const rec = { symbol: "EURUSD", direction: "long" as const, entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, timeframe: "5m" };
    expect(D.recordDiscrepancies(D.cleanFields(fields({ entry: r(1.08251, "observed", "x") }), "tradingview"), rec)).toEqual([]);
    expect(D.recordDiscrepancies(D.cleanFields(fields({ entry: r(1.0835, "observed", "x") }), "tradingview"), rec).map((d) => d.topic)).toEqual(["Entry"]);
  });

  it("derives the overall strategy fit from the rule verdicts", () => {
    const rule = (required: boolean, status: (typeof D.RULE_STATUS)[number]) => ({ required, status });
    expect(D.overallFit([])).toBe("cannot_tell");
    expect(D.overallFit([rule(true, "met"), rule(true, "not_met")])).toBe("inconsistent");
    expect(D.overallFit([rule(true, "met"), rule(false, "not_met")])).toBe("consistent");
    expect(D.overallFit([rule(true, "met"), rule(true, "not_visible")])).toBe("partly");
    expect(D.overallFit([rule(true, "not_visible"), rule(false, "met")])).toBe("cannot_tell");
    // only optional rules: never a green "consistent", even when some are met
    expect(D.overallFit([rule(false, "met"), rule(false, "not_met")])).toBe("no_required");
    expect(D.overallFit([rule(false, "not_visible")])).toBe("cannot_tell");
  });
});

describe("rendering", () => {
  it("shows observed, inferred and unknown apart, with status badges and the app's checks", async () => {
    const { ScreenshotAnalysisView } = await import("@/components/ai/ScreenshotAnalysisView");
    const fields = D.cleanFields(modelOutput().fields, "tradingview");
    const a = D.buildAnalysis(modelOutput(), {
      record: { symbol: "EURUSD", direction: "long", entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, timeframe: "15m" },
      strategy: "S", rules: [{ id: "R1", text: "Setup is counter-trend", kind: "invalidation", required: true }],
      image: { width: 1280, height: 720, sentWidth: 1280, sentHeight: 720 }, promptVersion: "test",
    });
    const html = renderToStaticMarkup(h(ScreenshotAnalysisView, { a, meta: { model: "claude-opus-5-5", at: "now", inputTokens: 1, outputTokens: 1 } }));
    for (const s of [">Observed<", ">Inferred (likely)<", ">Unknown<", ">Inferred<", "1:3.00", "Timeframe: chart 5, record 15m", "checked by the app", "Not visible", "not how the trade will turn out"]) expect(html).toContain(s);
    expect(fields.takeProfit.status).toBe("observed");

    // after the trader corrects the record, the app's mismatch goes away without a new (paid) analysis
    const fixed = D.againstCurrentRecord(a, { symbol: "EURUSD", direction: "long", entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, timeframe: "5m" }, "S");
    expect(fixed.analysis.discrepancies.map((d) => d.topic)).not.toContain("Timeframe");
    expect(fixed.strategyChanged).toBe(false);
    const moved = D.againstCurrentRecord(a, { symbol: "EURUSD", direction: "long", entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, timeframe: "15m" }, "Other strategy");
    expect(moved.strategyChanged).toBe(true);
    expect(renderToStaticMarkup(h(ScreenshotAnalysisView, { a: moved.analysis, strategyChanged: true, meta: { model: "m", at: "now", inputTokens: null, outputTokens: null } }))).toContain("strategy changed after this analysis");
  });

  it("quick-entry panel offers Fill only for observed readings into empty fields", async () => {
    const { ScreenshotReadings } = await import("@/components/ai/ScreenshotQuickEntry");
    const result = { chartSource: "mt5" as const, fields: D.cleanFields(modelOutput().fields, "mt5"), unknown: ["Higher-timeframe trend"] };
    const form = { symbol: "", direction: "long" as const, entryPrice: "", initialStop: "1.0800", takeProfit: "", timeframe: "" };
    const html = renderToStaticMarkup(h(ScreenshotReadings, { state: { imageId: "i", name: "chart.png", status: "done", result, model: "m" }, form, directionChosen: false, onApply: () => {}, onClose: () => {} }));
    expect(html).toContain("Fill empty fields (4)"); // symbol, timeframe, entry, take profit; not the typed stop, not the inferred direction
    expect(html).toContain("Form has 1.0800; left unchanged.");
    expect((html.match(/>Use</g) ?? []).length).toBe(5); // the inferred direction gets its own Use button
  });

  it("the trade card says when there are no screenshots and when AI isn't configured", async () => {
    const { ScreenshotAnalysisCard } = await import("@/components/ai/ScreenshotAnalysisCard");
    const tradeId = m.trades.saveTrade(A, m.validation.tradeInput.parse({ accountId: acctA, symbol: "GBPUSD", direction: "short", status: "open", openedAt: "2026-03-04T08:00:00Z", closedAt: "", entryPrice: 1.27 }));
    m.client.setAiClientForTests(null);
    const html = renderToStaticMarkup(await ScreenshotAnalysisCard({ userId: A, tradeId, tz: "UTC" }));
    expect(html).toContain("no screenshots yet");
    expect(html).toContain("Not configured: add ANTHROPIC_API_KEY on the server");
    expect(html).not.toContain("<button");
  });
});
