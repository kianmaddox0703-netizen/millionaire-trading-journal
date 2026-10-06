import { z } from "zod";
import { twelveDataSymbol } from "@/domain/instruments";
import { HOUR, type Candle } from "@/domain/marketContext";
import { blockedOnTheWay, fetchWithTimeout, MarketDataError, safeText, type FetchLike, type Granularity, type MarketDataProvider } from "./types";

/**
 * Twelve Data: GET https://api.twelvedata.com/time_series
 * Contract from twelvedata.com/docs and the official twelvedata-python client (endpoints.py, http_client.py):
 *  - auth: header "Authorization: apikey <key>" (the docs' recommended method), so the key is never in a URL
 *  - query: symbol ("EUR/USD"), interval (1h, 4h, 1day ...), start_date/end_date ("2006-01-02T15:04:05",
 *    read in `timezone`), timezone=UTC, outputsize (1..5000), order=asc, format=JSON
 *  - 200: { meta, values: [{ datetime "YYYY-MM-DD HH:mm:ss" (bar open time), open, high, low, close (strings), volume? }], status: "ok" }
 *  - errors: { code, message, status: "error" }, sometimes with HTTP 200, so the body's status is checked too.
 *    401 bad key, 403 plan lacks access, 404 no data, 429 credits exhausted (Basic plan: 8 per minute, 800 per day).
 * There is no "complete" flag, so a bar counts as complete once its hour has passed.
 */
const BASE = "https://api.twelvedata.com/time_series";
const INTERVAL: Record<Granularity, string> = { H1: "1h", H4: "4h", D1: "1day" };
const STEP: Record<Granularity, number> = { H1: HOUR, H4: 4 * HOUR, D1: 24 * HOUR };

const num = z.string().transform((s, ctx) => {
  const n = Number(s);
  if (!Number.isFinite(n)) ctx.addIssue({ code: "custom", message: "not a number" });
  return n;
});
const okBody = z.object({ values: z.array(z.object({ datetime: z.string(), open: num, high: num, low: num, close: num })) });
const errBody = z.object({ status: z.literal("error"), code: z.number().optional(), message: z.string().optional() });

const utc = (d: Date) => d.toISOString().slice(0, 19); // 2006-01-02T15:04:05 in UTC

/** "2021-09-16 15:59:00" or "2021-09-16" (UTC because the request asks for timezone=UTC). */
export function parseTdDatetime(s: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(s.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2] ?? "00:00:00"}${m[2]?.length === 5 ? ":00" : ""}Z`);
  return Number.isFinite(t) ? t : null;
}

export class TwelveDataProvider implements MarketDataProvider {
  readonly id = "twelvedata";
  readonly label = "Twelve Data";
  // Basic plan: 8 credits a minute, 1 credit per time_series symbol. 8 s spacing keeps under it.
  readonly minIntervalMs = 8_000;
  readonly batchSize = 6;
  readonly #key: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #now: () => number;

  constructor(opts: { apiKey: string; fetch?: FetchLike; timeoutMs?: number; now?: () => number }) {
    this.#key = opts.apiKey;
    this.#fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.#timeoutMs = opts.timeoutMs ?? 20_000;
    this.#now = opts.now ?? Date.now;
  }

  instrumentFor(symbol: string) {
    return twelveDataSymbol(symbol);
  }

  async candles(instrument: string, granularity: Granularity, from: Date, to: Date): Promise<Candle[]> {
    const q = new URLSearchParams({ symbol: instrument, interval: INTERVAL[granularity], start_date: utc(from), end_date: utc(to), timezone: "UTC", outputsize: "5000", order: "asc", format: "JSON" });
    const res = await fetchWithTimeout(this.#fetch, `${BASE}?${q}`, { headers: { Authorization: `apikey ${this.#key}` } }, this.#timeoutMs, "Twelve Data");
    let json: unknown = null;
    try { json = await res.json(); } catch { /* handled below */ }
    const blocked = res.ok ? null : blockedOnTheWay(res.status, json, "Twelve Data", "api.twelvedata.com");
    if (blocked) throw blocked;
    const err = errBody.safeParse(json);
    if (!res.ok || err.success) throw this.#error(err.success ? err.data.code ?? res.status : res.status, instrument, err.success ? err.data.message : undefined);
    const parsed = okBody.safeParse(json);
    if (!parsed.success) throw new MarketDataError("bad_response", "Twelve Data returned candles in an unexpected format.");
    const step = STEP[granularity], now = this.#now();
    const out: Candle[] = [];
    for (const v of parsed.data.values) {
      const t = parseTdDatetime(v.datetime);
      if (t === null) throw new MarketDataError("bad_response", "Twelve Data returned a candle time in an unexpected format.");
      out.push({ t, o: v.open, h: v.high, l: v.low, c: v.close, complete: t + step <= now });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  #error(code: number, symbol: string, message?: string) {
    const msg = safeText(message, this.#key);
    if (code === 401) return new MarketDataError("auth", "Twelve Data rejected the API key. Check TWELVEDATA_API_KEY.");
    if (code === 429) return new MarketDataError("rate_limit", "Twelve Data's API credit limit was reached (the free Basic plan allows 8 requests a minute and 800 a day). Try again later.");
    if (code === 403) return new MarketDataError("not_found", `Your Twelve Data plan doesn't include ${symbol}.`);
    if (code === 404) return new MarketDataError("not_found", `Twelve Data has no data for ${symbol} in this period${msg ? ` (${msg})` : ""}.`);
    if (code === 400 || code === 414) return new MarketDataError("bad_request", `Twelve Data rejected the request${msg ? `: ${msg}` : ""}.`);
    if (code >= 500) return new MarketDataError("network", `Twelve Data is unavailable right now (error ${code}). Try again later.`);
    return new MarketDataError("bad_response", `Twelve Data answered with error ${code}.`);
  }
}
