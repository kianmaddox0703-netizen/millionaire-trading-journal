import { describe, it, expect } from "vitest";
import { sessionOf, weekStartOf, ymd } from "@/domain/sessions";
import { findEdges, groupStats } from "@/domain/edge";
import { setupScore } from "@/domain/score";
import { strategyVerdict } from "@/domain/verdict";
import { rHistogram } from "@/domain/report";
import { matchScore, bestTradeFor, parseAlertBody, intervalLabel, alertSide } from "@/domain/matching";

describe("sessions", () => {
  it("uses local market hours across DST", () => {
    expect(sessionOf(new Date("2026-01-14T08:30:00Z"))).toBe("London"); // GMT
    expect(sessionOf(new Date("2026-07-14T07:30:00Z"))).toBe("London"); // BST 08:30
    expect(sessionOf(new Date("2026-07-14T13:30:00Z"))).toBe("London/NY overlap");
    expect(sessionOf(new Date("2026-07-14T18:00:00Z"))).toBe("New York");
    expect(sessionOf(new Date("2026-07-14T02:00:00Z"))).toBe("Tokyo");
    expect(sessionOf(new Date("2026-07-11T10:00:00Z"))).toBe("Off-hours"); // Saturday
  });
  it("week start and local day", () => {
    expect(weekStartOf("2026-10-04")).toBe("2026-09-28"); // Sunday → previous Monday
    expect(ymd(new Date("2026-10-05T02:00:00Z"), "America/New_York")).toBe("2026-10-04");
  });
});

const mk = (n: number, r: number, sym: string, ses: string) => Array.from({ length: n }, (_, i) => ({ id: `${sym}${ses}${i}`, netPnl: r * 100, rMultiple: r, sym, ses }));

describe("edge finder", () => {
  it("ranks a large consistent edge above a tiny lucky group", () => {
    const trades = [...mk(60, 1, "EURUSD", "London"), ...mk(60, -0.5, "GBPJPY", "NY"), ...mk(5, 3, "AUDUSD", "Tokyo")];
    const { strongest, weakest } = findEdges(trades, { Symbol: (t) => t.sym, Session: (t) => t.ses }, 0.2, 5);
    expect(["EURUSD", "London"]).toContain(strongest[0].conditions[0].value);
    expect(strongest.findIndex((c) => c.conditions[0].value === "AUDUSD")).toBeGreaterThan(0);
    expect(weakest[0].stat.avgR).toBeLessThan(0);
    const g = groupStats(trades, (t) => t.sym, 0.2).find((x) => x.key === "AUDUSD")!;
    expect(g.strength).toBe("insufficient");
  });
});

describe("setup score", () => {
  it("weights rated factors only", () => {
    const f = [{ key: "a", label: "A", weight: 30 }, { key: "b", label: "B", weight: 10 }];
    expect(setupScore(f, { a: 2, b: 0 })).toBeCloseTo(7.5);
    expect(setupScore(f, { a: 1 })).toBeCloseTo(5);
    expect(setupScore(f, {})).toBeNull();
  });
});

describe("strategy verdict", () => {
  it("refuses to judge small samples", () => {
    expect(strategyVerdict([3, 3, 3]).label).toBe("Not enough trades");
    expect(strategyVerdict(Array.from({ length: 40 }, (_, i) => (i % 3 ? 1.2 : -1))).tone).toBe("profit");
    expect(strategyVerdict(Array.from({ length: 40 }, (_, i) => (i % 2 ? 2 : -2))).tone).toBe("warn");
  });
});

describe("R histogram", () => {
  it("clamps extremes into edge bins", () => {
    const h = rHistogram([{ netPnl: 1, rMultiple: 9, day: "" }, { netPnl: -1, rMultiple: -7, day: "" }, { netPnl: 0, rMultiple: 0, day: "" }]);
    expect(h[0].count).toBe(1);
    expect(h.at(-1)!.count).toBe(1);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(3);
  });
});

describe("TradingView alert matching", () => {
  const alert = { id: "a1", symbol: "EURUSD", side: "long", price: 1.0825, time: new Date("2026-03-04T08:00:00Z") };
  const trade = (o = {}) => ({ id: "t1", symbol: "EURUSD", direction: "long" as const, openedAt: new Date("2026-03-04T08:05:00Z"), entryPrice: 1.0826, ...o });

  it("scores a close, same-direction trade highly and rejects mismatches", () => {
    expect(matchScore(alert, trade())).toBeGreaterThan(0.95);
    expect(matchScore(alert, trade({ direction: "short" }))).toBeNull();
    expect(matchScore(alert, trade({ symbol: "GBPUSD" }))).toBeNull();
    expect(matchScore(alert, trade({ openedAt: new Date("2026-03-04T12:30:00Z") }))).toBeNull(); // > 4h later
    expect(matchScore(alert, trade({ openedAt: new Date("2026-03-04T07:45:00Z") }))).toBeNull(); // > 10 min before
    expect(matchScore({ ...alert, symbol: "OANDA:EURUSD" }, trade({ symbol: "EURUSD.r" }))).toBeGreaterThan(0.9);
  });
  it("prefers the nearer trade, skips rejected pairs, and caps alerts without price", () => {
    const near = trade({ id: "near" }), far = trade({ id: "far", openedAt: new Date("2026-03-04T10:30:00Z"), entryPrice: 1.0850 });
    expect(bestTradeFor(alert, [far, near])!.trade.id).toBe("near");
    expect(bestTradeFor(alert, [far, near], new Set(["a1:near"]))?.trade.id ?? null).toBe(null); // far scores below 0.5
    expect(matchScore({ ...alert, price: null }, trade())).toBeLessThanOrEqual(0.8);
  });
  it("parses TradingView JSON and plain-text alerts", () => {
    const p = parseAlertBody('{"symbol":"FX:EURUSD","timeframe":"240","price":1.0825,"side":"buy","setup":"AOI","time":"2026-03-04T08:00:00Z","message":"hi"}');
    expect(p).toMatchObject({ symbol: "EURUSD", timeframe: "4H", price: 1.0825, side: "buy", setup: "AOI", message: "hi" });
    expect(p.alertTime!.toISOString()).toBe("2026-03-04T08:00:00.000Z");
    expect(parseAlertBody("EURUSD crossed 1.08")).toMatchObject({ symbol: null, message: "EURUSD crossed 1.08" });
    expect(parseAlertBody('{"price":"abc","time":"nope"}')).toMatchObject({ price: null, alertTime: null });
    expect(["15", "60", "240", "D", "1W", "3D"].map(intervalLabel)).toEqual(["15m", "1H", "4H", "D", "W", "3D"]);
    expect(alertSide("Sell")).toBe("short");
  });
});
