import { describe, it, expect } from "vitest";
import {
  normalizeSymbol, wallClockToUtc, parseDate, parseNumber, parseDirection, autoMap, rowToTrade, decodeText, htmlRows,
  detectMt5Report, initialStopsFromOrders, aggregateMt5, findDuplicate, headerTable, type Mt5Deal,
} from "@/domain/importing";

import { utf16Fixture } from "./fixtures";

describe("symbols", () => {
  it("strips broker prefixes and suffixes", () => {
    expect(["OANDA:EURUSD", "EURUSD.r", "eurusd-ECN", "EURUSDm", "EUR/USD", "FX:EURUSD", "EURUSD#"].map(normalizeSymbol)).toEqual(Array(7).fill("EURUSD"));
    expect(normalizeSymbol("XAUUSDc")).toBe("XAUUSD");
    expect(normalizeSymbol("US30")).toBe("US30");
    expect(normalizeSymbol("GER40.cash")).toBe("GER40.CASH");
  });
});

describe("timezones", () => {
  it("MT5 New York close server time is UTC+2 in winter and UTC+3 in US summer time", () => {
    expect(wallClockToUtc(Date.UTC(2026, 0, 15, 10, 0), "BROKER_NY7").toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(wallClockToUtc(Date.UTC(2026, 6, 1, 10, 0), "BROKER_NY7").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    // US DST starts 8 Mar 2026, EU on 29 Mar: in between, NY-close servers are already UTC+3
    expect(wallClockToUtc(Date.UTC(2026, 2, 16, 10, 0), "BROKER_NY7").toISOString()).toBe("2026-03-16T07:00:00.000Z");
    expect(wallClockToUtc(Date.UTC(2026, 2, 16, 10, 0), "Europe/Athens").toISOString()).toBe("2026-03-16T08:00:00.000Z");
    expect(wallClockToUtc(Date.UTC(2026, 6, 1, 9, 0), "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(wallClockToUtc(Date.UTC(2026, 6, 1, 9, 0), "UTC").toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });
});

describe("value parsing", () => {
  it("parses broker number formats", () => {
    expect(parseNumber("1 234.56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("-7,5")).toBe(-7.5);
    expect(parseNumber("(12.30)")).toBe(-12.3);
    expect(parseNumber("$-40")).toBe(-40);
    expect(parseNumber("0.10 / 0.10")).toBe(0.1);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
  it("parses dates in MT5, ISO, day-first and Excel formats", () => {
    expect(parseDate("2026.03.04 09:15:22", "UTC")!.toISOString()).toBe("2026-03-04T09:15:22.000Z");
    expect(parseDate("2026-03-04T09:15:00Z", "BROKER_NY7")!.toISOString()).toBe("2026-03-04T09:15:00.000Z"); // explicit zone wins
    expect(parseDate("25/03/2026 14:00", "UTC")!.toISOString()).toBe("2026-03-25T14:00:00.000Z");
    expect(parseDate("03/04/2026 14:00", "UTC")!.toISOString()).toBe("2026-03-04T14:00:00.000Z");
    expect(parseDate("03/04/2026 14:00", "UTC", true)!.toISOString()).toBe("2026-04-03T14:00:00.000Z");
    expect(parseDate(46085.5, "UTC")!.toISOString()).toBe("2026-03-04T12:00:00.000Z");
    expect(parseDate("2026-13-01", "UTC")).toBeNull();
    expect(parseDate("yesterday", "UTC")).toBeNull();
  });
  it("parses directions", () => {
    expect(["buy", "Buy Limit", "LONG", "b"].map(parseDirection)).toEqual(["long", "long", "long", "long"]);
    expect(["sell", "Short", "s"].map(parseDirection)).toEqual(["short", "short", "short"]);
    expect(parseDirection("balance")).toBeNull();
  });
});

describe("column auto-mapping", () => {
  it("maps the MT5 Positions header including repeated Time/Price columns", () => {
    const h = ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"];
    expect(autoMap(h)).toEqual({ openedAt: 0, externalRef: 1, symbol: 2, direction: 3, sizeLots: 4, entryPrice: 5, initialStop: 6, takeProfit: 7, closedAt: 8, exitPrice: 9, commission: 10, swap: 11, grossPnl: 12 });
  });
  it("maps a typical journal CSV header", () => {
    const m = autoMap(["Ticket", "Open Time", "Close Time", "Pair", "Side", "Lots", "Entry Price", "Exit Price", "Stop Loss", "Take Profit", "Net P&L", "Commission", "Notes"]);
    expect(m).toMatchObject({ externalRef: 0, openedAt: 1, closedAt: 2, symbol: 3, direction: 4, sizeLots: 5, entryPrice: 6, exitPrice: 7, initialStop: 8, takeProfit: 9, netPnl: 10, commission: 11, notes: 12 });
  });
});

describe("row conversion", () => {
  const map = autoMap(["Symbol", "Type", "Open Time", "Close Time", "Open Price", "Close Price", "SL", "TP", "Profit"]);
  it("builds a closed trade", () => {
    const r = rowToTrade(["EURUSD", "buy", "2026.03.04 09:00", "2026.03.04 12:00", "1.0825", "1.0845", "1.0815", "1.0855", "200"], map, "UTC");
    expect(r.trade).toMatchObject({ symbol: "EURUSD", direction: "long", status: "closed", entryPrice: 1.0825, exitPrice: 1.0845, initialStop: 1.0815, grossPnl: 200, warnings: [] });
  });
  it("drops a stop that was moved to breakeven or beyond, with a warning", () => {
    const r = rowToTrade(["EURUSD", "buy", "2026.03.04 09:00", "2026.03.04 12:00", "1.0825", "1.0845", "1.0830", "", "200"], map, "UTC");
    expect(r.trade!.initialStop).toBeNull();
    expect(r.trade!.warnings[0]).toMatch(/moved/);
  });
  it("reports clear errors", () => {
    expect(rowToTrade(["", "buy", "2026.03.04", "", "1", "", "", "", ""], map).error).toMatch(/symbol/);
    expect(rowToTrade(["EURUSD", "balance", "2026.03.04", "", "1", "", "", "", ""], map).error).toMatch(/Direction/);
    expect(rowToTrade(["EURUSD", "buy", "soon", "", "1", "", "", "", ""], map).error).toMatch(/Open time/);
    expect(rowToTrade(["EURUSD", "buy", "2026.03.04 10:00", "2026.03.04 09:00", "1", "1.1", "", "", "5"], map).error).toMatch(/before open/);
  });
  it("leaves a row without close data open", () => {
    expect(rowToTrade(["EURUSD", "sell", "2026.03.04 09:00", "", "1.0825", "", "", "", ""], map).trade!.status).toBe("open");
  });
});

describe("MT5 HTML report", () => {
  const rows = htmlRows(decodeText(utf16Fixture("mt5-report.html")));
  const report = detectMt5Report(rows)!;
  it("decodes UTF-16 and finds the Positions and Orders sections, skipping hidden spacer cells", () => {
    expect(report.positions!.headers).toEqual(["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"]);
    expect(report.positions!.rows).toHaveLength(3);
    expect(report.orders!.rows).toHaveLength(3);
    expect(report.hasDeals).toBe(true);
  });
  it("takes initial stops from the opening order", () => {
    const stops = initialStopsFromOrders(report.orders);
    expect(stops.get("5001")).toEqual({ sl: 1.0815, tp: 1.0855 });
    expect(stops.get("5004")).toEqual({ sl: null, tp: null });
  });
  it("converts positions in server time", () => {
    const m = autoMap(report.positions!.headers);
    const t = report.positions!.rows.map((r) => rowToTrade(r, m, "BROKER_NY7").trade!);
    expect(t[0]).toMatchObject({ symbol: "EURUSD", direction: "long", externalRef: "5001", initialStop: null, commission: -7, grossPnl: 200 });
    expect(t[0].openedAt.toISOString()).toBe("2026-01-15T08:00:05.000Z");
    expect(t[1].openedAt.toISOString()).toBe("2026-07-01T13:20:00.000Z");
    expect(t[2]).toMatchObject({ symbol: "XAUUSD", entryPrice: 2350.5, exitPrice: 2360.5, sizeLots: 0.1 });
  });
  it("does not mistake an ordinary CSV for a report", () => {
    expect(detectMt5Report([["Symbol", "Type"], ["EURUSD", "buy"]])).toBeNull();
    expect(headerTable([[], ["a", "b"], ["", ""], ["1", "2"]])).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });
});

describe("MT5 deal aggregation", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 2, 4, h));
  const deal = (o: Partial<Mt5Deal>): Mt5Deal => ({ ticket: String(Math.random()), positionId: "P1", time: at(9), type: "buy", entry: "in", symbol: "EURUSD", volume: 1, price: 1.08, commission: -3.5, swap: 0, profit: 0, ...o });
  it("combines scale-in and partial exits with volume-weighted prices", () => {
    const [t] = aggregateMt5([
      deal({ price: 1.08, volume: 1 }), deal({ price: 1.082, volume: 1, time: at(10) }),
      deal({ type: "sell", entry: "out", price: 1.085, volume: 1, time: at(11), profit: 400 }),
      deal({ type: "sell", entry: "out", price: 1.086, volume: 1, time: at(12), profit: 500, swap: -1 }),
    ], new Map([["P1", { sl: 1.077, tp: 1.09 }]]));
    expect(t).toMatchObject({ direction: "long", status: "closed", sizeLots: 2, grossPnl: 900, commission: -14, swap: -1, initialStop: 1.077, externalRef: "P1" });
    expect(t.entryPrice).toBeCloseTo(1.081, 9);
    expect(t.exitPrice).toBeCloseTo(1.0855, 9);
    expect(t.closedAt).toEqual(at(12));
  });
  it("keeps a partially closed position open and ignores balance deals", () => {
    const out = aggregateMt5([
      deal({ positionId: "P2", type: "sell", volume: 2 }), deal({ positionId: "P2", type: "buy", entry: "out", volume: 1, time: at(10) }),
      deal({ positionId: "0", type: "balance", entry: "in" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ direction: "short", status: "open", exitPrice: null, grossPnl: null });
  });
  it("skips positions whose entry deal is outside the synced window", () => {
    expect(aggregateMt5([deal({ type: "sell", entry: "out" })])).toEqual([]);
  });
});

describe("duplicate detection", () => {
  const existing = [
    { id: "a", seq: 1, symbol: "EURUSD", direction: "long" as const, openedAt: new Date("2026-03-04T09:00:00Z"), entryPrice: 1.0825, sizeLots: 1, externalRef: null },
    { id: "b", seq: 2, symbol: "GBPUSD", direction: "short" as const, openedAt: new Date("2026-03-05T09:00:00Z"), entryPrice: 1.27, sizeLots: 0.5, externalRef: "777" },
  ];
  const t = { symbol: "EURUSD", direction: "long" as const, openedAt: new Date("2026-03-04T09:01:10Z"), entryPrice: 1.08252, sizeLots: 1, externalRef: "999" };
  it("matches a hand-journaled trade by symbol, direction, time, price and size", () => {
    expect(findDuplicate(t, existing)?.trade.id).toBe("a");
  });
  it("matches by broker ID", () => {
    expect(findDuplicate({ ...t, symbol: "X", externalRef: "777" }, existing)?.reason).toMatch(/broker ID/);
  });
  it("does not match different size, time, direction or a different broker ID", () => {
    expect(findDuplicate({ ...t, sizeLots: 2 }, existing)).toBeNull();
    expect(findDuplicate({ ...t, openedAt: new Date("2026-03-04T09:05:00Z") }, existing)).toBeNull();
    expect(findDuplicate({ ...t, direction: "short" }, existing)).toBeNull();
    expect(findDuplicate({ ...t, symbol: "GBPUSD", direction: "short", entryPrice: 1.27, sizeLots: 0.5, openedAt: existing[1].openedAt, externalRef: "778" }, existing)).toBeNull();
  });
});
