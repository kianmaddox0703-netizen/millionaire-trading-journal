import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { oandaInstrument, twelveDataSymbol, priceOffsetLikely } from "@/domain/instruments";
import {
  atr, ema, resample, tradingClock, computeContext, swingLevels, keyLevelReading, volatilityReading, trendReading,
  parseContextDetails, biasAlignment, HOUR, type Candle, type Bar,
} from "@/domain/marketContext";
import { OandaProvider } from "@/server/marketdata/oanda";
import { TwelveDataProvider, parseTdDatetime } from "@/server/marketdata/twelvedata";
import { MarketDataError, type MarketDataProvider, type Granularity } from "@/server/marketdata/types";

// Isolated database per test run; no provider from the host environment.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtj-md-test-"));
process.env.DATA_DIR = dir;
for (const k of ["MARKET_DATA_PROVIDER", "OANDA_API_TOKEN", "OANDA_ENV", "TWELVEDATA_API_KEY"]) delete process.env[k];

// ───────────── SYNTHETIC fixtures: constructed candle series to test the math. Never shown in the app. ─────────────

/** Consecutive hourly candles starting at `start`, each closing at closes[i]. */
function hourly(start: number, closes: number[], pad = 0.0003, range?: (i: number) => number): Candle[] {
  let prev = closes[0];
  return closes.map((c, i) => {
    const o = prev; prev = c;
    const p = range ? range(i) : pad;
    return { t: start + i * HOUR, o, h: Math.max(o, c) + p, l: Math.min(o, c) - p, c, complete: true };
  });
}
const rising = (n: number, from = 1.0, step = 0.0005) => Array.from({ length: n }, (_, i) => from + i * step);
const falling = (n: number, from = 1.5, step = 0.0005) => Array.from({ length: n }, (_, i) => from - i * step);
const wavy = (n: number) => Array.from({ length: n }, (_, i) => 1.1 + 0.002 * Math.sin(i / 2));
const T0 = Date.UTC(2026, 0, 5, 0, 0); // Mon 5 Jan 2026 00:00 UTC

describe("symbol mapping", () => {
  it("maps FX pairs and metals to OANDA instruments", () => {
    expect(oandaInstrument("EURUSD")).toBe("EUR_USD");
    expect(oandaInstrument("OANDA:XAUUSD")).toBe("XAU_USD");
    expect(oandaInstrument("xauusd.r")).toBe("XAU_USD");
    expect(oandaInstrument("EURUSD_i")).toBe("EUR_USD");
    expect(oandaInstrument("GOLD")).toBe("XAU_USD");
    expect(oandaInstrument("XAGEUR")).toBe("XAG_EUR");
    expect(oandaInstrument("gbp/jpy")).toBe("GBP_JPY");
  });
  it("maps confirmed OANDA CFD names and common aliases, nothing else", () => {
    expect(oandaInstrument("US30.cash")).toBe("US30_USD");
    expect(oandaInstrument("US500")).toBe("SPX500_USD");
    expect(oandaInstrument("NAS100")).toBe("NAS100_USD");
    expect(oandaInstrument("SPX500_USD")).toBe("SPX500_USD");
    expect(oandaInstrument("USOIL")).toBe("WTICO_USD");
    expect(oandaInstrument("BTCUSD")).toBe("BTC_USD");
    for (const s of ["GER40", "AAPL", "EURRUB", "XYZ", "USDUSD"]) expect(oandaInstrument(s)).toBeNull();
  });
  it("maps to Twelve Data symbols only where the symbol format is confirmed", () => {
    expect(twelveDataSymbol("EURUSD")).toBe("EUR/USD");
    expect(twelveDataSymbol("GBPJPY.pro")).toBe("GBP/JPY");
    expect(twelveDataSymbol("XAUUSD")).toBe("XAU/USD");
    expect(twelveDataSymbol("XAGUSD")).toBe("XAG/USD");
    expect(twelveDataSymbol("USOIL")).toBe("WTI/USD");
    expect(twelveDataSymbol("BTCUSD")).toBe("BTC/USD");
    expect(twelveDataSymbol("XPTUSD")).toBeNull();
    expect(twelveDataSymbol("US30")).toBeNull();
    expect(twelveDataSymbol("UKOIL")).toBeNull();
  });
  it("flags instruments whose broker prices can be offset", () => {
    expect(priceOffsetLikely("US30")).toBe(true);
    expect(priceOffsetLikely("EURUSD")).toBe(false);
    expect(priceOffsetLikely("XAUUSD")).toBe(false);
  });
});

describe("indicators", () => {
  it("EMA is seeded with the SMA and then smoothed", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]); // k = 0.5
    expect(ema(Array(60).fill(5), 50).at(-1)).toBe(5);
  });
  it("ATR is Wilder's average of true ranges, including gaps", () => {
    const bars: Candle[] = [
      { t: 0, o: 10, h: 11, l: 9, c: 10 }, // TR 2
      { t: 1, o: 10, h: 12, l: 10, c: 11 }, // TR max(2, 2, 0) = 2... plus gap check below
      { t: 2, o: 14, h: 15, l: 14, c: 15 }, // TR max(1, |15-11|, |14-11|) = 4
      { t: 3, o: 15, h: 16, l: 15, c: 15 }, // TR 1
    ];
    const a = atr(bars, 3);
    expect(a.slice(0, 2)).toEqual([null, null]);
    expect(a[2]).toBeCloseTo((2 + 2 + 4) / 3, 12);
    expect(a[3]).toBeCloseTo(((8 / 3) * 2 + 1) / 3, 12);
  });
});

describe("New York close alignment", () => {
  it("days roll over at 17:00 New York in winter and summer", () => {
    expect(tradingClock(Date.UTC(2026, 0, 14, 21))).toEqual({ day: "2026-01-14", hour: 23 }); // 16:00 EST
    expect(tradingClock(Date.UTC(2026, 0, 14, 22))).toEqual({ day: "2026-01-15", hour: 0 }); // 17:00 EST
    expect(tradingClock(Date.UTC(2026, 6, 15, 20))).toEqual({ day: "2026-07-15", hour: 23 }); // 16:00 EDT
    expect(tradingClock(Date.UTC(2026, 6, 15, 21))).toEqual({ day: "2026-07-16", hour: 0 }); // 17:00 EDT
  });
  it("resamples H1 into H4 and D1 bars with the right boundaries and OHLC", () => {
    const start = Date.UTC(2026, 0, 14, 22); // 17:00 EST
    const h1 = hourly(start, Array.from({ length: 24 }, (_, i) => 1 + i / 100), 0);
    const d1 = resample(h1, 24);
    expect(d1).toHaveLength(1);
    expect(d1[0]).toMatchObject({ t: start, end: start + 24 * HOUR, o: 1, c: 1.23, n: 24 });
    expect(d1[0].h).toBeCloseTo(1.23, 12);
    const h4 = resample(h1, 4);
    expect(h4.map((b) => new Date(b.t).getUTCHours())).toEqual([22, 2, 6, 10, 14, 18]);
    expect(h4.every((b) => b.n === 4 && b.end === b.t + 4 * HOUR)).toBe(true);
    // a candle in the middle of a bucket still gets the bucket's nominal start
    expect(resample([h1[5]], 4)[0].t).toBe(Date.UTC(2026, 0, 15, 2));
  });
  it("an FX week (closed Fri 17:00 to Sun 17:00 New York) has five daily bars, Monday's starting Sunday 17:00", () => {
    const sun = Date.UTC(2026, 0, 11, 22); // Sun 17:00 EST
    const h1 = hourly(sun, Array(5 * 24).fill(1.1)); // through Fri 17:00 EST
    const days = resample(h1, 24).map((b) => tradingClock(b.t).day);
    expect(days).toEqual(["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"]);
    const nextSun = Date.UTC(2026, 0, 18, 22);
    const week2 = resample([...h1, ...hourly(nextSun, Array(3).fill(1.1))], 24);
    expect(week2.at(-1)!.t).toBe(nextSun); // the weekend adds no bar
    expect(week2.at(-2)!.end).toBe(Date.UTC(2026, 0, 16, 22));
  });
});

describe("context readings", () => {
  it("rising, falling and wavy series give bullish, bearish and ranging/neutral", () => {
    const at = (closes: number[]) => {
      const c = hourly(T0, closes);
      const r = computeContext(c, T0 + closes.length * HOUR, closes.at(-1)!);
      if (!r.ok) throw new Error(r.reason);
      return r.value;
    };
    const up = at(rising(800));
    expect([up.trend, up.htfBias]).toEqual(["bullish", "bullish"]);
    const down = at(falling(800));
    expect([down.trend, down.htfBias]).toEqual(["bearish", "bearish"]);
    const flat = at(wavy(800));
    expect([flat.trend, flat.htfBias]).toEqual(["ranging", "neutral"]);
    expect(up.details.h1!.slope10).toBeGreaterThan(0);
    expect(up.details.candles.h1).toBe(800);
  });

  it("needs enough candles and says so", () => {
    const r = computeContext(hourly(T0, rising(30)), T0 + 30 * HOUR, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Only 30 hourly candles/);
    expect(trendReading(hourly(T0, rising(59)))).toBeNull();
    expect(trendReading(hourly(T0, rising(60)))).not.toBeNull();
  });

  it("volatility compares ATR at entry with the median of the prior 100", () => {
    const n = 220;
    const normal = hourly(T0, Array(n).fill(1.1), 0.001);
    expect(volatilityReading(normal)!.value).toBe("normal");
    const high = hourly(T0, Array(n).fill(1.1), 0, (i) => (i >= n - 30 ? 0.003 : 0.001));
    const hv = volatilityReading(high)!;
    expect(hv.value).toBe("high");
    expect(hv.ratio).toBeGreaterThan(1.33);
    const low = hourly(T0, Array(n).fill(1.1), 0, (i) => (i >= n - 30 ? 0.0003 : 0.001));
    expect(volatilityReading(low)!.value).toBe("low");
    expect(volatilityReading(hourly(T0, Array(113).fill(1.1)))).toBeNull();
  });

  it("finds unbroken H4 swing levels and the nearest level to the entry", () => {
    const mk = (h: number[], l: number[], c: number[]): Bar[] => h.map((x, i) => ({ t: i * 4 * HOUR, end: (i + 1) * 4 * HOUR, o: c[i], h: x, l: l[i], c: c[i], n: 4 }));
    const highs = [1.0, 1.1, 1.5, 1.2, 1.1, 1.0, 1.0];
    const lows = [0.9, 0.8, 0.9, 0.95, 0.5, 0.95, 0.96];
    const closes = [0.95, 1.0, 1.2, 1.0, 0.9, 0.97, 0.98];
    const s = swingLevels(mk(highs, lows, closes), 0);
    expect(s).toEqual([{ kind: "h4_swing_high", price: 1.5, at: 2 * 4 * HOUR }, { kind: "h4_swing_low", price: 0.5, at: 4 * 4 * HOUR }]);
    // a later close beyond the swing high breaks it
    const broken = swingLevels(mk(highs, lows, [...closes.slice(0, 6), 1.6]), 0);
    expect(broken.map((x) => x.kind)).toEqual(["h4_swing_low"]);
    // swings before the window are ignored
    expect(swingLevels(mk(highs, lows, closes), 3 * 4 * HOUR).map((x) => x.kind)).toEqual(["h4_swing_low"]);

    const prev = { t: 0, end: 24 * HOUR, o: 1, h: 1.2, l: 0.8, c: 1, n: 24 };
    const near = keyLevelReading(1.198, 0.01, prev, s)!;
    expect(near.near).toBe(true);
    expect(near.nearest).toMatchObject({ kind: "prev_day_high", price: 1.2 });
    expect(near.nearest!.distanceAtr).toBeCloseTo(0.2, 9);
    const far = keyLevelReading(1.0, 0.01, prev, s)!;
    expect(far.near).toBe(false);
    expect(keyLevelReading(1, 0.01, null, [])).toBeNull();
  });

  it("uses the previous complete New York day for the day high/low", () => {
    // 3 full NY days (22:00 UTC starts in January), entry 2 h into the 4th day
    const start = Date.UTC(2026, 0, 11, 22);
    const closes = Array.from({ length: 74 }, (_, i) => 1.1 + (Math.floor(i / 24) === 2 ? 0.01 : 0) + (i % 24 === 12 ? 0.005 : 0));
    const r = computeContext(hourly(start, closes, 0.0001), start + 74 * HOUR, 1.1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.details.prevDay!.t).toBe(start + 48 * HOUR);
    expect(r.value.details.prevDay!.h).toBeCloseTo(1.1 + 0.01 + 0.005 + 0.0001, 9);
    expect(r.value.details.candles.d1).toBe(3); // the 4th day was still open at entry
  });

  it("NO LOOKAHEAD: candles after the entry, or still open at it, change nothing", () => {
    const closes = rising(500);
    const before = hourly(T0, closes);
    const entry = T0 + 500 * HOUR + 30 * 60_000; // 30 min into candle #500
    const base = computeContext(before, entry, 1.2);
    // candle #500 (contains the entry) and later ones: a huge spike that would flip every reading
    const after = hourly(T0 + 500 * HOUR, [0.2, 0.1, 0.05, 0.01], 0.5);
    const withFuture = computeContext([...before, ...after], entry, 1.2);
    expect(withFuture).toEqual(base);
    if (!base.ok) throw new Error(base.reason);
    expect(base.value.details.candles.to).toBe(T0 + 500 * HOUR); // last close used = start of the entry candle
    // a candle the provider marks incomplete is ignored too
    const incomplete = { ...before[499], c: 0.01, l: 0.01, complete: false };
    expect(computeContext([...before.slice(0, 499), incomplete], entry, 1.2)).toEqual(computeContext(before.slice(0, 499), entry, 1.2));
    // and an H4 bucket still open at entry is dropped
    expect(base.value.details.candles.h4).toBe(resample(before, 4).filter((b) => b.end <= entry).length);
  });

  it("stores details that read back through the schema; bad JSON is flagged as null", () => {
    const r = computeContext(hourly(T0, rising(300)), T0 + 300 * HOUR, 1.1);
    if (!r.ok) throw new Error(r.reason);
    const json = JSON.stringify({ v: 1, input: { symbol: "EURUSD", openedAt: new Date(T0).toISOString(), entryPrice: 1.1 }, computed: r.value.details });
    expect(parseContextDetails(json)?.computed?.candles.h1).toBe(300);
    expect(parseContextDetails("{not json")).toBeNull();
    expect(parseContextDetails(JSON.stringify({ v: 1 }))).toBeNull();
  });

  it("bias alignment relative to the trade direction", () => {
    expect(biasAlignment("long", "bullish")).toBe("With HTF bias");
    expect(biasAlignment("short", "bullish")).toBe("Against HTF bias");
    expect(biasAlignment("short", "bearish")).toBe("With HTF bias");
    expect(biasAlignment("long", "neutral")).toBe("Neutral HTF");
    expect(biasAlignment("long", null)).toBeNull();
  });
});

// ───────────── HTTP clients against an injected fetch (TEST DOUBLE: canned responses, no network) ─────────────

type Seen = { url: string; headers: Record<string, string> };
function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fn = async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return respond(url);
  };
  return { fn, seen };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const errOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as MarketDataError; } throw new Error("expected a failure"); };

describe("OANDA client", () => {
  const TOKEN = "test-oanda-token-123";
  const from = new Date(Date.UTC(2026, 0, 1)), to = new Date(Date.UTC(2026, 1, 10, 8, 30));

  it("requests mid H1 candles with bearer auth and UNIX times, and parses string prices", async () => {
    const f = fakeFetch(() => json(200, {
      instrument: "EUR_USD", granularity: "H1",
      candles: [
        { time: "1767225600.000000000", volume: 12, complete: true, mid: { o: "1.10000", h: "1.10100", l: "1.09900", c: "1.10050" } },
        { time: "1767229200.000000000", volume: 3, complete: false, mid: { o: "1.10050", h: "1.10060", l: "1.10000", c: "1.10010" } },
      ],
    }));
    const c = await new OandaProvider({ token: TOKEN, env: "practice", fetch: f.fn }).candles("EUR_USD", "H1", from, to);
    const u = new URL(f.seen[0].url);
    expect(u.host).toBe("api-fxpractice.oanda.com");
    expect(u.pathname).toBe("/v3/instruments/EUR_USD/candles");
    expect(Object.fromEntries(u.searchParams)).toEqual({ price: "M", granularity: "H1", from: String(from.getTime() / 1000), to: String(to.getTime() / 1000) });
    expect(f.seen[0].headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Accept-Datetime-Format": "UNIX" });
    expect(c).toEqual([
      { t: 1767225600000, o: 1.1, h: 1.101, l: 1.099, c: 1.1005, complete: true },
      { t: 1767229200000, o: 1.1005, h: 1.1006, l: 1.1, c: 1.1001, complete: false },
    ]);
  });

  it("uses the live host for OANDA_ENV=live", async () => {
    const f = fakeFetch(() => json(200, { candles: [] }));
    const p = new OandaProvider({ token: TOKEN, env: "live", fetch: f.fn });
    await p.candles("XAU_USD", "D1", from, to);
    expect(new URL(f.seen[0].url).host).toBe("api-fxtrade.oanda.com");
    expect(new URL(f.seen[0].url).searchParams.get("granularity")).toBe("D");
    expect(p.label).toBe("OANDA (live)");
  });

  it("maps HTTP errors to typed, token-free messages", async () => {
    const cases: [Response, string][] = [
      [json(401, { errorMessage: `Insufficient authorization to perform request. ${TOKEN}` }), "auth"],
      [json(403, { errorMessage: "The provided request was forbidden." }), "auth"],
      // a proxy or firewall refusing the host answers 403 without OANDA's JSON error body
      [new Response("Host not in allowlist: api-fxpractice.oanda.com", { status: 403 }), "network"],
      [json(429, {}), "rate_limit"],
      [json(400, { errorMessage: "Invalid value specified for 'instrument'" }), "not_found"],
      [json(400, { errorMessage: "Invalid value specified for 'from'" }), "bad_request"],
      [json(503, {}), "network"],
      [json(200, { candles: [{ time: "x", mid: { o: "1", h: "1", l: "1", c: "1" }, complete: true }] }), "bad_response"],
      [new Response("<html>oops</html>", { status: 200 }), "bad_response"],
    ];
    for (const [res, kind] of cases) {
      const e = await errOf(new OandaProvider({ token: TOKEN, env: "practice", fetch: async () => res }).candles("EUR_USD", "H1", from, to));
      expect(e).toBeInstanceOf(MarketDataError);
      expect([e.kind, e.message]).toEqual([kind, expect.not.stringContaining(TOKEN)]);
      expect(e.message).not.toContain("http");
    }
  });

  it("says a blocked host is a network problem, not a bad token", async () => {
    const e = await errOf(new OandaProvider({ token: TOKEN, env: "practice", fetch: async () => new Response("Host not in allowlist", { status: 403 }) }).candles("EUR_USD", "H1", from, to));
    expect(e.message).toMatch(/blocked before OANDA answered.*api-fxpractice\.oanda\.com/);
    expect(e.message).not.toMatch(/token/i);
  });

  it("network failures and timeouts become network errors", async () => {
    const down = await errOf(new OandaProvider({ token: TOKEN, env: "practice", fetch: async () => { throw new TypeError("fetch failed"); } }).candles("EUR_USD", "H1", from, to));
    expect([down.kind, down.message]).toEqual(["network", "Couldn't reach OANDA. Check the server's network access."]);
    const hang = (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    const slow = await errOf(new OandaProvider({ token: TOKEN, env: "practice", fetch: hang, timeoutMs: 20 }).candles("EUR_USD", "H1", from, to));
    expect(slow.kind).toBe("network");
    expect(slow.message).toMatch(/didn't answer/);
  });
});

describe("Twelve Data client", () => {
  const KEY = "td-test-key-456";
  const from = new Date(Date.UTC(2026, 0, 1)), to = new Date(Date.UTC(2026, 1, 10, 8, 30));

  it("sends the key in the Authorization header, never in the URL, and parses UTC bars", async () => {
    const f = fakeFetch(() => json(200, {
      meta: { symbol: "EUR/USD", interval: "1h" }, status: "ok",
      values: [{ datetime: "2026-02-10 07:00:00", open: "1.1", high: "1.2", low: "1.0", close: "1.15" }, { datetime: "2026-02-10 06:00:00", open: "1.0", high: "1.1", low: "0.9", close: "1.1" }],
    }));
    const now = Date.UTC(2026, 1, 10, 7, 30);
    const c = await new TwelveDataProvider({ apiKey: KEY, fetch: f.fn, now: () => now }).candles("EUR/USD", "H1", from, to);
    const u = new URL(f.seen[0].url);
    expect(u.origin + u.pathname).toBe("https://api.twelvedata.com/time_series");
    expect(Object.fromEntries(u.searchParams)).toEqual({ symbol: "EUR/USD", interval: "1h", start_date: "2026-01-01T00:00:00", end_date: "2026-02-10T08:30:00", timezone: "UTC", outputsize: "5000", order: "asc", format: "JSON" });
    expect(f.seen[0].url).not.toContain(KEY);
    expect(f.seen[0].headers).toEqual({ Authorization: `apikey ${KEY}` });
    expect(c).toEqual([
      { t: Date.UTC(2026, 1, 10, 6), o: 1.0, h: 1.1, l: 0.9, c: 1.1, complete: true },
      { t: Date.UTC(2026, 1, 10, 7), o: 1.1, h: 1.2, l: 1.0, c: 1.15, complete: false }, // its hour hasn't passed at `now`
    ]);
  });

  it("parses datetimes and rejects odd ones", () => {
    expect(parseTdDatetime("2021-09-16 15:59:00")).toBe(Date.UTC(2021, 8, 16, 15, 59));
    expect(parseTdDatetime("2021-09-16")).toBe(Date.UTC(2021, 8, 16));
    expect(parseTdDatetime("16/09/2021")).toBeNull();
  });

  it("maps error bodies (also when sent with HTTP 200) to typed errors without the key", async () => {
    const cases: [Response, string][] = [
      [json(200, { code: 429, message: "You have run out of API credits for the current minute.", status: "error" }), "rate_limit"],
      [json(401, { code: 401, message: `**apikey** parameter is incorrect: ${KEY}`, status: "error" }), "auth"],
      [json(200, { code: 404, message: `Symbol not found ${KEY}`, status: "error" }), "not_found"],
      [json(200, { code: 403, message: "plan", status: "error" }), "not_found"],
      [new Response("Forbidden", { status: 403 }), "network"],
      [json(200, { code: 400, message: "No data is available on the specified dates.", status: "error" }), "bad_request"],
      [json(200, { status: "ok", values: [{ datetime: "yesterday", open: "1", high: "1", low: "1", close: "1" }] }), "bad_response"],
      [json(200, { status: "ok" }), "bad_response"],
    ];
    for (const [res, kind] of cases) {
      const e = await errOf(new TwelveDataProvider({ apiKey: KEY, fetch: async () => res }).candles("EUR/USD", "H1", from, to));
      expect(e).toBeInstanceOf(MarketDataError);
      expect([e.kind, e.message]).toEqual([kind, expect.not.stringContaining(KEY)]);
    }
  });
});

// ───────────── storage and orchestration with a provider TEST DOUBLE ─────────────

/** TEST DOUBLE provider: returns a synthetic rising H1 series for any request. Not real market data. */
class FakeProvider implements MarketDataProvider {
  readonly id = "fake";
  readonly label = "Fake provider (test double)";
  readonly minIntervalMs = 0;
  batchSize = 3;
  calls: { instrument: string; from: Date; to: Date }[] = [];
  failWith: Error | null = null;
  instrumentFor(symbol: string) { return oandaInstrument(symbol); }
  async candles(instrument: string, _g: Granularity, from: Date, to: Date) {
    this.calls.push({ instrument, from, to });
    if (this.failWith) throw this.failWith;
    const first = Math.ceil(from.getTime() / HOUR) * HOUR;
    const n = Math.floor((to.getTime() - first) / HOUR) + 1; // includes the candle containing `to`
    return hourly(first, rising(n, 1.0, 0.0002));
  }
}

type Mods = {
  db: typeof import("@/server/db");
  trades: typeof import("@/server/trades");
  validation: typeof import("@/domain/validation");
  ids: typeof import("@/server/ids");
  ctx: typeof import("@/server/marketdata/context");
  provider: typeof import("@/server/marketdata/provider");
};
let m: Mods;
let fake: FakeProvider;

function makeUser(email: string) {
  const id = m.ids.newId();
  m.db.db.insert(m.db.schema.users).values({ id, email, passwordHash: "x", timezone: "UTC" }).run();
  m.trades.bootstrapUser(id);
  const acct = m.db.db.select().from(m.db.schema.accounts).all().find((a) => a.userId === id)!;
  return { id, acct: acct.id };
}
const trade = (accountId: string, over: Record<string, unknown> = {}) =>
  m.validation.tradeInput.parse({
    accountId, symbol: "EURUSD", direction: "long", status: "closed",
    openedAt: "2026-03-03T08:30:00Z", closedAt: "2026-03-03T12:00:00Z",
    entryPrice: 1.0825, initialStop: 1.0815, exitPrice: 1.0845, grossPnl: 200, riskAmount: 100, ...over,
  });
const row = (tradeId: string) => m.db.db.select().from(m.db.schema.marketContext).all().find((r) => r.tradeId === tradeId);

beforeAll(async () => {
  m = {
    db: await import("@/server/db"),
    trades: await import("@/server/trades"),
    validation: await import("@/domain/validation"),
    ids: await import("@/server/ids"),
    ctx: await import("@/server/marketdata/context"),
    provider: await import("@/server/marketdata/provider"),
  };
});
afterEach(() => m.provider.setMarketDataProviderForTests(null));
const useFake = () => { fake = new FakeProvider(); m.provider.setMarketDataProviderForTests(fake); return fake; };

describe("provider configuration", () => {
  it("is off without config, explains a missing key, and builds the configured client", () => {
    expect(m.provider.providerStatus()).toMatchObject({ id: "none", ready: false });
    expect(m.provider.activeProvider()).toBeNull();
    process.env.MARKET_DATA_PROVIDER = "oanda";
    try {
      expect(m.provider.providerStatus()).toMatchObject({ ready: false, problem: expect.stringContaining("OANDA_API_TOKEN is empty") });
      process.env.OANDA_API_TOKEN = "configured-token";
      expect(m.provider.providerStatus()).toMatchObject({ ready: true, label: "OANDA (practice)" });
      expect(m.provider.activeProvider()).toBeInstanceOf(OandaProvider);
      expect(JSON.stringify(m.provider.activeProvider())).not.toContain("configured-token");
      process.env.MARKET_DATA_PROVIDER = "twelvedata";
      expect(m.provider.providerStatus().problem).toMatch(/TWELVEDATA_API_KEY is empty/);
      process.env.TWELVEDATA_API_KEY = "k";
      expect(m.provider.activeProvider()).toBeInstanceOf(TwelveDataProvider);
    } finally {
      for (const k of ["MARKET_DATA_PROVIDER", "OANDA_API_TOKEN", "TWELVEDATA_API_KEY"]) delete process.env[k];
    }
  });

  it("spaces requests per provider", async () => {
    const p = { ...new FakeProvider(), id: "spaced", minIntervalMs: 60 } as unknown as MarketDataProvider;
    const t = Date.now();
    await m.provider.throttle(p); await m.provider.throttle(p);
    expect(Date.now() - t).toBeGreaterThanOrEqual(55);
  });
});

describe("market context storage", () => {
  it("does nothing when no provider is configured", async () => {
    const { id: U, acct } = makeUser("none@test.local");
    const id = m.trades.saveTrade(U, trade(acct));
    await m.ctx.refreshContextForTrades(U, [id], "manual");
    expect(row(id)).toBeUndefined();
  });

  it("computes and stores context once, then skips until the trade changes", async () => {
    const f = useFake();
    const { id: U, acct } = makeUser("ok@test.local");
    const id = m.trades.saveTrade(U, trade(acct));
    await m.ctx.refreshContextForTrades(U, [id], "manual");
    const r = row(id)!;
    expect(r).toMatchObject({ userId: U, provider: "fake", instrument: "EUR_USD", status: "ok", error: null, trend: "bullish", htfBias: "bullish", volatility: "normal", session: "London" });
    expect(r.atr).toBeGreaterThan(0);
    expect(typeof r.nearKeyLevel).toBe("boolean");
    expect(r.computedAt).toBeInstanceOf(Date);
    // one request per trade covering 40 days up to entry
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].to.toISOString()).toBe("2026-03-03T08:30:00.000Z");
    expect((f.calls[0].to.getTime() - f.calls[0].from.getTime()) / 86_400_000).toBe(40);
    const d = m.ctx.contextFor(U, id)!.details!;
    expect(d.input).toEqual({ symbol: "EURUSD", openedAt: "2026-03-03T08:30:00.000Z", entryPrice: 1.0825 });
    expect(d.computed!.candles.to).toBeLessThanOrEqual(Date.parse("2026-03-03T08:30:00Z"));

    await m.ctx.refreshContextForTrades(U, [id], "mt5_bridge");
    expect(f.calls).toHaveLength(1); // unchanged trade: skipped

    m.trades.saveTrade(U, trade(acct, { openedAt: "2026-03-04T14:00:00Z", closedAt: "2026-03-04T15:00:00Z" }), id);
    expect(m.ctx.stateOf(m.ctx.contextFor(U, id)!, { id, symbol: "EURUSD", openedAt: new Date("2026-03-04T14:00:00Z"), entryPrice: 1.0825 })).toBe("stale");
    await m.ctx.refreshContextForTrades(U, [id], "manual");
    expect(f.calls).toHaveLength(2);
    expect(m.ctx.contextFor(U, id)!.details!.input.openedAt).toBe("2026-03-04T14:00:00.000Z");
    expect(row(id)!.session).toBe("London/NY overlap");
  });

  it("marks unmapped symbols unsupported without a request", async () => {
    const f = useFake();
    const { id: U, acct } = makeUser("unsup@test.local");
    const id = m.trades.saveTrade(U, trade(acct, { symbol: "GER40", entryPrice: 18000, initialStop: 17950, exitPrice: 18050 }));
    await m.ctx.refreshContextForTrades(U, [id], "import");
    expect(row(id)).toMatchObject({ status: "unsupported", instrument: null, trend: null });
    expect(row(id)!.error).toMatch(/GER40 has no Fake provider \(test double\) instrument mapping/);
    expect(f.calls).toHaveLength(0);
    expect(m.ctx.stateOf(m.ctx.contextFor(U, id)!, { id, symbol: "GER40", openedAt: new Date("2026-03-03T08:30:00Z"), entryPrice: 18000 }, "fake")).toBe("unsupported");
    // after switching to another provider the symbol is tried again
    expect(m.ctx.stateOf(m.ctx.contextFor(U, id)!, { id, symbol: "GER40", openedAt: new Date("2026-03-03T08:30:00Z"), entryPrice: 18000 }, "oanda")).toBe("stale");
  });

  it("only touches the signed-in user's trades", async () => {
    const f = useFake();
    const a = makeUser("iso-a@test.local"), b = makeUser("iso-b@test.local");
    const bTrade = m.trades.saveTrade(b.id, trade(b.acct));
    await m.ctx.refreshContextForTrades(a.id, [bTrade], "manual");
    expect(row(bTrade)).toBeUndefined();
    expect(f.calls).toHaveLength(0);
    await m.ctx.refreshContextForTrades(b.id, [bTrade], "manual");
    expect(row(bTrade)?.status).toBe("ok");
    expect(m.ctx.contextFor(a.id, bTrade)).toBeNull();
    expect(m.ctx.contextsByTrade(a.id).has(bTrade)).toBe(false);
    expect((await m.ctx.refreshTradeContext(a.id, bTrade)).message).toBe("Trade not found.");
    expect(f.calls).toHaveLength(1);
  });

  it("stores provider errors; background runs don't retry them, a manual save does", async () => {
    const f = useFake();
    const { id: U, acct } = makeUser("err@test.local");
    const id = m.trades.saveTrade(U, trade(acct));
    f.failWith = new MarketDataError("not_found", "OANDA has no candles for EUR_USD on this account.");
    await m.ctx.refreshContextForTrades(U, [id], "manual");
    expect(row(id)).toMatchObject({ status: "error", error: "OANDA has no candles for EUR_USD on this account.", trend: null });
    await m.ctx.refreshContextForTrades(U, [id], "mt5_bridge");
    expect(f.calls).toHaveLength(1);
    f.failWith = null;
    await m.ctx.refreshContextForTrades(U, [id], "manual");
    expect(row(id)!.status).toBe("ok");
  });

  it("never throws; unexpected failures get a generic message", async () => {
    const f = useFake();
    const { id: U, acct } = makeUser("boom@test.local");
    const id = m.trades.saveTrade(U, trade(acct));
    f.failWith = new Error("socket hang up at https://example.invalid/?apikey=secret");
    await expect(m.ctx.refreshContextForTrades(U, [id], "manual")).resolves.toBeUndefined();
    expect(row(id)).toMatchObject({ status: "error", error: "Computing the market context failed. Try Refresh." });
  });

  it("caps a run to one batch, queues the rest as pending, and the button works through them", async () => {
    const f = useFake();
    const { id: U, acct } = makeUser("cap@test.local");
    const ids = Array.from({ length: 5 }, (_, i) => m.trades.saveTrade(U, trade(acct, { openedAt: `2026-03-0${i + 2}T09:00:00Z`, closedAt: `2026-03-0${i + 2}T10:00:00Z` })));
    await m.ctx.refreshContextForTrades(U, ids, "import");
    expect(f.calls).toHaveLength(3);
    expect(ids.map((i) => row(i)!.status)).toEqual(["pending", "pending", "ok", "ok", "ok"]); // newest first
    expect(m.ctx.contextCounts(U)).toMatchObject({ total: 5, ok: 3, pending: 2, missing: 2 });
    const r = await m.ctx.fetchMissingContext(U);
    expect(r).toMatchObject({ ok: 2, fetched: 2, remaining: 0, stopped: null });
    expect(ids.every((i) => row(i)!.status === "ok")).toBe(true);
  });

  it("stops the batch on a rejected token or rate limit instead of repeating it", async () => {
    const f = useFake();
    const { id: U, acct } = makeUser("auth@test.local");
    const ids = Array.from({ length: 3 }, (_, i) => m.trades.saveTrade(U, trade(acct, { openedAt: `2026-03-0${i + 2}T09:00:00Z`, closedAt: `2026-03-0${i + 2}T10:00:00Z` })));
    f.failWith = new MarketDataError("auth", "OANDA rejected the API token (HTTP 401).");
    await m.ctx.refreshContextForTrades(U, ids, "import");
    expect(f.calls).toHaveLength(1);
    expect(ids.map((i) => row(i)!.status)).toEqual(["pending", "pending", "error"]);
    f.failWith = new MarketDataError("rate_limit", "Rate limit reached.");
    const r = await m.ctx.fetchMissingContext(U);
    expect(f.calls).toHaveLength(2);
    expect(r).toMatchObject({ pending: 1, stopped: "Rate limit reached.", remaining: 3 });
  });
});
