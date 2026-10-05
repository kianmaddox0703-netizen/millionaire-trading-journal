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
