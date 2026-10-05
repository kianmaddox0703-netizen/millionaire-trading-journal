import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";

// Isolated database + uploads per test run.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-test-"));
process.env.DATA_DIR = dir;

type Mods = {
  db: typeof import("@/server/db");
  trades: typeof import("@/server/trades");
  analytics: typeof import("@/server/analytics");
  storage: typeof import("@/server/storage");
  validation: typeof import("@/domain/validation");
  ids: typeof import("@/server/ids");
  importer: typeof import("@/server/importer");
};
let m: Mods;
let A: string, B: string, acctA: string, acctB: string;

function makeUser(email: string) {
  const id = m.ids.newId();
  m.db.db.insert(m.db.schema.users).values({ id, email, passwordHash: "x", timezone: "UTC" }).run();
  m.trades.bootstrapUser(id);
  const acct = m.db.db.select().from(m.db.schema.accounts).all().find((a) => a.userId === id)!;
  return { id, acct: acct.id };
}

const base = (accountId: string, over: Record<string, unknown> = {}) =>
  m.validation.tradeInput.parse({
    accountId, symbol: "eurusd", direction: "long", status: "closed",
    openedAt: "2026-03-03T08:30:00Z", closedAt: "2026-03-03T12:00:00Z",
    entryPrice: 1.0825, initialStop: 1.0815, takeProfit: 1.0855, exitPrice: 1.0845,
    grossPnl: 200, commission: -7, riskAmount: 100, ...over,
  });

beforeAll(async () => {
  m = {
    db: await import("@/server/db"),
    trades: await import("@/server/trades"),
    analytics: await import("@/server/analytics"),
    storage: await import("@/server/storage"),
    validation: await import("@/domain/validation"),
    ids: await import("@/server/ids"),
    importer: await import("@/server/importer"),
  };
  ({ id: A, acct: acctA } = makeUser("a@test.local"));
  ({ id: B, acct: acctB } = makeUser("b@test.local"));
});

describe("trade lifecycle", () => {
  it("creates a trade with derived metrics and an auto session", () => {
    const id = m.trades.saveTrade(A, base(acctA));
    const t = m.db.db.select().from(m.db.schema.trades).all().find((x) => x.id === id)!;
    expect(t.symbol).toBe("EURUSD");
    expect(t.netPnl).toBeCloseTo(193, 6);
    expect(t.rMultiple).toBeCloseTo(1.93, 6);
    expect(t.plannedRr).toBeCloseTo(3, 6);
    expect(t.riskPct).toBeCloseTo(1, 6); // $100 of the $10,000 starting balance
    expect(t.session).toBe("London");
    expect(t.seq).toBe(1);
  });

  it("edits recompute metrics; deletes cascade", () => {
    const id = m.trades.saveTrade(A, base(acctA, { notes: { lesson: "wait" }, psych: { fomo: true }, emotions: { before: "fomo" } }));
    m.trades.saveTrade(A, base(acctA, { exitPrice: 1.0815, grossPnl: -100 }), id);
    const t = m.db.db.select().from(m.db.schema.trades).all().find((x) => x.id === id)!;
    expect(t.rMultiple).toBeCloseTo(-1.07, 6);
    const mistakes = m.db.db.select().from(m.db.schema.tradeMistakes).all().filter((x) => x.tradeId === id);
    expect(mistakes.map((x) => x.mistakeKey)).not.toContain("fomo"); // flag cleared by the edit
    m.trades.deleteTrade(A, id);
    expect(m.db.db.select().from(m.db.schema.tradeNotes).all().some((x) => x.tradeId === id)).toBe(false);
    expect(m.db.db.select().from(m.db.schema.psychologyEntries).all().some((x) => x.tradeId === id)).toBe(false);
  });

  it("validation rejects a closed trade without exit or P&L, and close before open", () => {
    const r1 = m.validation.tradeInput.safeParse({ accountId: acctA, symbol: "X", direction: "long", status: "closed", openedAt: "2026-01-01T00:00:00Z", closedAt: "2026-01-01T01:00:00Z", entryPrice: 1 });
    expect(r1.success).toBe(false);
    const r2 = m.validation.tradeInput.safeParse({ accountId: acctA, symbol: "X", direction: "long", status: "closed", openedAt: "2026-01-02T00:00:00Z", closedAt: "2026-01-01T00:00:00Z", entryPrice: 1, exitPrice: 2 });
    expect(r2.success).toBe(false);
  });
});

describe("authorization / data isolation", () => {
  it("another user cannot edit, delete, or attach to my records", () => {
    const id = m.trades.saveTrade(A, base(acctA));
    expect(() => m.trades.saveTrade(B, base(acctB), id)).toThrow(m.trades.NotFoundError);
    expect(() => m.trades.deleteTrade(B, id)).toThrow(m.trades.NotFoundError);
    expect(() => m.trades.saveTrade(B, base(acctA))).toThrow(m.trades.NotFoundError); // A's account
    const stratA = m.db.db.select().from(m.db.schema.strategies).all().find((s) => s.userId === A)!;
    expect(() => m.trades.saveTrade(B, base(acctB, { strategyId: stratA.id }))).toThrow(m.trades.NotFoundError);
    expect(m.analytics.loadTrades(B, "UTC").some((t) => t.id === id)).toBe(false);
  });
});

describe("rule-based mistake detection", () => {
  it("flags oversizing, low R:R, restricted day, and loss limits", () => {
    const { id: U, acct } = makeUser("rules@test.local");
    m.db.db.update(m.db.schema.riskRules).set({ maxRiskPct: 1, minRr: 2, restrictedDays: "0,6", maxConsecutiveLosses: 2, maxTradesPerDay: 3 })
      .where(eq(m.db.schema.riskRules.userId, U)).run();
    const big = m.trades.saveTrade(U, base(acct, { riskAmount: 200, takeProfit: 1.0835 })); // 2% risk, 1:1 planned
    const keys = (tid: string) => m.db.db.select().from(m.db.schema.tradeMistakes).all().filter((x) => x.tradeId === tid).map((x) => x.mistakeKey);
    expect(keys(big)).toEqual(expect.arrayContaining(["oversized", "low_rr", "outside_plan"]));
    const sat = m.trades.saveTrade(U, base(acct, { openedAt: "2026-03-07T09:00:00Z", closedAt: "2026-03-07T10:00:00Z" }));
    expect(keys(sat)).toContain("restricted_time");
    // two losers then a third trade → loss limit
    const loss = { exitPrice: 1.0815, grossPnl: -100 };
    m.trades.saveTrade(U, base(acct, { ...loss, openedAt: "2026-03-10T08:00:00Z", closedAt: "2026-03-10T08:30:00Z" }));
    m.trades.saveTrade(U, base(acct, { ...loss, openedAt: "2026-03-10T09:00:00Z", closedAt: "2026-03-10T09:30:00Z" }));
    const third = m.trades.saveTrade(U, base(acct, { openedAt: "2026-03-10T10:00:00Z", closedAt: "2026-03-10T11:00:00Z" }));
    expect(keys(third)).toContain("loss_limit");
    const fourth = m.trades.saveTrade(U, base(acct, { openedAt: "2026-03-10T12:00:00Z", closedAt: "2026-03-10T13:00:00Z" }));
    expect(keys(fourth)).toContain("overtrading");
  });
});

describe("search & filters", () => {
  it("finds trades by mistake phrase and symbol", () => {
    const { id: U, acct } = makeUser("search@test.local");
    const a = m.trades.saveTrade(U, base(acct, { psych: { movedStop: true } }));
    const b = m.trades.saveTrade(U, base(acct, { symbol: "GBPJPY", entryPrice: 190, initialStop: 189, takeProfit: 193, exitPrice: 191, grossPnl: 100 }));
    const all = m.analytics.loadTrades(U, "UTC");
    const ids = (q: string) => m.analytics.applyFilter(all, { q }).map((t) => t.id);
    expect(ids("trades where I moved my stop")).toEqual([a]);
    expect(ids("GBPJPY")).toEqual([b]);
    expect(ids("trades from march").length).toBe(2);
    expect(ids("trades from april").length).toBe(0);
    expect(m.analytics.applyFilter(all, { mistake: "moved_stop" }).map((t) => t.id)).toEqual([a]);
  });
});

describe("image storage", () => {
  it("rejects non-images and spoofed types, stores originals untouched with a thumbnail", async () => {
    await expect(m.storage.storeImage(A, Buffer.from("not an image"))).rejects.toThrow(/JPEG, PNG and WebP/);
    await expect(m.storage.storeImage(A, Buffer.from("GIF89a....."))).rejects.toThrow();
    const png = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#123456" } }).png().toBuffer();
    const s = await m.storage.storeImage(A, png);
    expect(s.mime).toBe("image/png");
    expect([s.width, s.height]).toEqual([1920, 1080]);
    expect((await m.storage.readStored(s.storageKey)).equals(png)).toBe(true);
    const thumb = await sharp(await m.storage.readStored(s.thumbKey)).metadata();
    expect(thumb.format).toBe("webp");
    expect(thumb.width).toBe(640);
    await expect(m.storage.readStored("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("csv export", () => {
  it("escapes quotes and neutralises spreadsheet formulas", async () => {
    const { toCsv } = await import("@/lib/csv");
    const out = toCsv([{ a: '=HYPERLINK("x")', b: -5, c: "x,y", d: 'say "hi"' }]);
    expect(out).toBe('a,b,c,d\r\n"\'=HYPERLINK(""x"")",-5,"x,y","say ""hi"""\r\n');
  });
});

describe("file import", () => {
  const csv = [
    "Ticket,Open Time,Close Time,Symbol,Type,Lots,Open Price,Close Price,S/L,T/P,Profit,Commission,Swap,Strategy",
    "1001,2026-04-06 08:30,2026-04-06 12:00,EURUSD,buy,1,1.0825,1.0845,1.0815,1.0855,200,-7,0,FXAlexG Set & Forget",
    "1002,2026-04-07 14:00,2026-04-07 15:00,GBPJPY,sell,0.5,190.50,190.80,190.80,189.90,-100,-3.5,0,",
    "1003,bad date,,EURUSD,buy,1,1.08,,,,,,,",
  ].join("\n");
  const opts = (accountId: string, over = {}) => ({ accountId, mapping: {}, zone: "UTC", dayFirst: false, costsPositive: false, ...over });

  it("previews, imports, then flags re-imports and hand-journaled trades as duplicates", async () => {
    const { id: U, acct } = makeUser("import@test.local");
    const parsed = await m.importer.parseFile(Buffer.from(csv));
    expect(parsed.format).toBe("table");
    const o = opts(acct, { mapping: parsed.mapping });
    const pv = m.importer.buildPreview(U, parsed, o);
    expect(pv.map((p) => p.status)).toEqual(["new", "new", "error"]);

    // a trade journaled by hand before the import, without a ticket
    const manual = m.trades.saveTrade(U, base(acct, { openedAt: "2026-04-06T08:30:30Z", closedAt: "2026-04-06T12:00:00Z", sizeLots: 1, notes: { lesson: "patience" }, psych: { confidence: 8 } }));
    const pv2 = m.importer.buildPreview(U, parsed, o);
    expect(pv2[0]).toMatchObject({ status: "duplicate", duplicateOf: { id: manual } });

    const sum = m.importer.commitImport(U, parsed, o, { 1: "merge" });
    expect(sum).toMatchObject({ created: 1, merged: 1, skipped: 0 });
    expect(sum.failed).toEqual([{ row: 3, error: expect.stringMatching(/Open time/) }]);

    const rows = m.db.db.select().from(m.db.schema.trades).all().filter((t) => t.userId === U);
    expect(rows).toHaveLength(2);
    const merged = rows.find((t) => t.id === manual)!;
    expect(merged.externalRef).toBe("1001"); // broker ID attached to the journaled trade
    expect(merged.commission).toBe(-7);
    expect(m.db.db.select().from(m.db.schema.tradeNotes).all().find((n) => n.tradeId === manual)!.lesson).toBe("patience"); // journal kept
    expect(m.db.db.select().from(m.db.schema.tradePsychology).all().find((n) => n.tradeId === manual)!.confidence).toBe(8);
    const gj = rows.find((t) => t.symbol === "GBPJPY")!;
    expect(gj).toMatchObject({ source: "csv", externalRef: "1002", direction: "short", netPnl: -103.5 });
    expect(gj.rMultiple).toBeCloseTo(-1.035, 6);
    const gjMistakes = m.db.db.select().from(m.db.schema.tradeMistakes).all().filter((x) => x.tradeId === gj.id).map((x) => x.mistakeKey);
    expect(gjMistakes).not.toContain("outside_plan"); // unknown strategy on an import is not a mistake

    // importing the same file again: everything is a duplicate and skipped by default
    const again = m.importer.commitImport(U, parsed, o, {});
    expect(again).toMatchObject({ created: 0, merged: 0, skipped: 2 });
    // "create anyway" makes a second trade but cannot reuse the broker ID
    const forced = m.importer.commitImport(U, parsed, o, { 2: "create" });
    expect(forced.created).toBe(1);
    const copies = m.db.db.select().from(m.db.schema.trades).all().filter((t) => t.userId === U && t.symbol === "GBPJPY");
    expect(copies.map((c) => c.externalRef).sort()).toEqual(["1002", null].sort());
  });

  it("imports an MT5 HTML report with initial stops from the orders section", async () => {
    const { utf16Fixture } = await import("./fixtures");
    const { id: U, acct } = makeUser("mt5report@test.local");
    const parsed = await m.importer.parseFile(utf16Fixture("mt5-report.html"));
    expect(parsed.format).toBe("mt5_report");
    const sum = m.importer.commitImport(U, parsed, opts(acct, { mapping: parsed.mapping, zone: "BROKER_NY7" }), {});
    expect(sum).toMatchObject({ created: 3, failed: [] });
    const t = m.db.db.select().from(m.db.schema.trades).all().filter((x) => x.userId === U).sort((a, b) => a.seq - b.seq);
    expect(t[0]).toMatchObject({ source: "mt5_report", symbol: "EURUSD", initialStop: 1.0815, takeProfit: 1.0855, netPnl: 193 });
    expect(t[0].rMultiple).toBeCloseTo(1.93, 6);
    expect(t[0].openedAt.toISOString()).toBe("2026-01-15T08:00:05.000Z");
    expect(t[1]).toMatchObject({ symbol: "GBPUSD", direction: "short", initialStop: 1.272 });
    expect(t[1].rMultiple).toBeCloseTo(-1.047, 6);
    expect(t[2]).toMatchObject({ symbol: "XAUUSD", initialStop: null, rMultiple: null });
  });

  it("rejects other users' accounts and unreadable files", async () => {
    const parsed = await m.importer.parseFile(Buffer.from(csv));
    expect(() => m.importer.buildPreview(B, parsed, opts(acctA, { mapping: parsed.mapping }))).toThrow(m.trades.NotFoundError);
    await expect(m.importer.parseFile(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow(/Excel/);
    expect(() => m.importer.buildPreview(A, parsed, opts(acctA, { mapping: {} }))).toThrow(/Map these columns/);
  });

  it("detects costs written as positive numbers", () => {
    const t = (gross: number, comm: number, net: number) => ({ grossPnl: gross, netPnl: net, commission: comm, swap: 0, fees: null }) as never;
    expect(m.importer.costsLookPositive([t(100, 7, 93), t(-50, 7, -57)])).toBe(true);
    expect(m.importer.costsLookPositive([t(100, -7, 93)])).toBe(false);
    expect(m.importer.costsLookPositive([])).toBeNull();
  });
});

describe("TradingView webhook and links", () => {
  it("stores alerts, auto-links them, and remembers manual unlinks", async () => {
    const tv = await import("@/server/tradingview");
    const { id: U, acct } = makeUser("tv@test.local");
    const token = tv.createWebhookToken(U);
    expect(tv.userForWebhookToken(token)).toBe(U);
    expect(m.db.db.select().from(m.db.schema.webhookTokens).all().some((w) => w.tokenHash === token)).toBe(false); // only the hash is stored
    const tradeId = m.trades.saveTrade(U, base(acct, { openedAt: "2026-03-03T08:30:00Z" }));
    const alertId = tv.receiveAlert(U, JSON.stringify({ symbol: "OANDA:EURUSD", side: "long", price: 1.0824, time: "2026-03-03T08:20:00Z", setup: "AOI" }));
    let linked = tv.alertsForTrade(U, tradeId);
    expect(linked).toHaveLength(1);
    expect(linked[0].link).toMatchObject({ status: "confirmed", refId: alertId });

    tv.unlinkAlert(U, tradeId, alertId);
    tv.matchAlertsForUser(U);
    expect(tv.alertsForTrade(U, tradeId)).toHaveLength(0); // rejection is remembered
    const tradeRow = m.db.db.select().from(m.db.schema.trades).all().find((t) => t.id === tradeId)!;
    expect(tv.nearbyAlerts(U, tradeRow).map((a) => a.id)).toEqual([alertId]); // offered for manual linking by alert time
    tv.linkAlert(U, tradeId, alertId);
    linked = tv.alertsForTrade(U, tradeId);
    expect(linked[0].link).toMatchObject({ status: "confirmed", score: null });

    // other users can't link to my alerts; a rotated token stops working
    expect(() => tv.linkAlert(B, tradeId, alertId)).toThrow(m.trades.NotFoundError);
    tv.createWebhookToken(U);
    expect(tv.userForWebhookToken(token)).toBeNull();
  });
});

describe("MT5 bridge ingest", () => {
  it("builds trades from deals, updates them as they close, and merges into a hand-journaled trade", async () => {
    const mt5 = await import("@/server/mt5");
    const { id: U, acct } = makeUser("bridge@test.local");
    const key = mt5.createBridgeKey(U, acct, "PC");
    const conn = mt5.connectionForKey(key)!;
    expect(conn.accountId).toBe(acct);
    expect(mt5.connectionForKey("mtj_" + "x".repeat(43))).toBeNull();
    expect(() => mt5.createBridgeKey(B, acct, "steal")).toThrow(m.trades.NotFoundError);

    // MT5 server time (UTC+2 in winter): 10:30 server = 08:30 UTC
    const t0 = Date.UTC(2026, 2, 3, 10, 30) / 1000;
    const journaled = m.trades.saveTrade(U, base(acct, { status: "open", closedAt: null, exitPrice: null, grossPnl: null, commission: null, sizeLots: 1, notes: { why: "AOI retest" } }));
    const open = mt5.ingestSchema.parse({
      deals: [
        { ticket: 1, order: 900, position_id: 900, time: t0, type: 0, entry: 0, symbol: "EURUSD.r", volume: 1, price: 1.0825, commission: -3.5, swap: 0, profit: 0 },
        { ticket: 2, order: 901, position_id: 901, time: t0 + 3600, type: 1, entry: 0, symbol: "GBPUSD.r", volume: 0.5, price: 1.27, commission: -1.75, swap: 0, profit: 0 },
        { ticket: 3, position_id: 0, time: t0, type: 2, entry: 0, symbol: "", volume: 0, price: 0, profit: 1000 }, // balance deal, ignored
      ],
      orders: [{ ticket: 900, position_id: 900, sl: 1.0815, tp: 1.0855 }, { ticket: 901, position_id: 901, sl: 1.272, tp: 1.265 }],
    });
    expect(mt5.ingestMt5(conn, open)).toMatchObject({ deals: 2, created: 1, updated: 1 });
    const rows = () => m.db.db.select().from(m.db.schema.trades).all().filter((t) => t.userId === U);
    expect(rows()).toHaveLength(2);
    expect(rows().find((t) => t.id === journaled)).toMatchObject({ externalRef: "900", status: "open" });

    const close = mt5.ingestSchema.parse({
      deals: [
        { ticket: 4, order: 902, position_id: 900, time: t0 + 7200, type: 1, entry: 1, symbol: "EURUSD.r", volume: 1, price: 1.0845, commission: -3.5, swap: 0, profit: 200 },
        { ticket: 1, order: 900, position_id: 900, time: t0, type: 0, entry: 0, symbol: "EURUSD.r", volume: 1, price: 1.0825, commission: -3.5, swap: 0, profit: 0 }, // resent; stored once
      ],
    });
    expect(mt5.ingestMt5(conn, close)).toMatchObject({ created: 0, updated: 1 });
    const t = rows().find((x) => x.id === journaled)!;
    expect(t).toMatchObject({ status: "closed", exitPrice: 1.0845, grossPnl: 200, commission: -7, netPnl: 193, initialStop: 1.0815 });
    expect(t.rMultiple).toBeCloseTo(1.93, 6);
    expect(t.closedAt!.toISOString()).toBe("2026-03-03T10:30:00.000Z");
    expect(m.db.db.select().from(m.db.schema.tradeNotes).all().find((n) => n.tradeId === journaled)!.why).toBe("AOI retest");
    expect(m.db.db.select().from(m.db.schema.mt5Deals).all().filter((d) => d.accountId === acct)).toHaveLength(3);
    const gu = rows().find((x) => x.symbol === "GBPUSD")!;
    expect(gu).toMatchObject({ source: "mt5_bridge", direction: "short", status: "open", initialStop: 1.272, takeProfit: 1.265 });

    // re-sending the same data changes nothing
    expect(mt5.ingestMt5(conn, close)).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(m.db.db.select().from(m.db.schema.brokerConnections).all().find((c) => c.id === conn.id)!.lastSeenAt).toBeInstanceOf(Date);
  });
});
