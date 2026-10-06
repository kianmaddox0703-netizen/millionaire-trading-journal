import { z } from "zod";
import { oandaInstrument } from "@/domain/instruments";
import type { Candle } from "@/domain/marketContext";
import { blockedOnTheWay, fetchWithTimeout, MarketDataError, safeText, type FetchLike, type Granularity, type MarketDataProvider } from "./types";

/**
 * OANDA v20 REST: GET /v3/instruments/{instrument}/candles
 * Contract from oanda/v20-openapi (json/v20.json, v3.0.25) and oanda/v20-python, plus
 * developer.oanda.com (count default 500, max 5000; 120 requests/s, excess gets HTTP 429):
 *  - Authorization: "Bearer <token>"; Accept-Datetime-Format: "UNIX" makes times decimal seconds strings
 *  - query: price=M (mid), granularity, from, to (count is not sent when both from and to are)
 *  - 200: { instrument, granularity, candles: [{ time, mid: {o,h,l,c} as strings, volume, complete }] }
 *  - errors: 400/401/403/404/405 with { errorCode?, errorMessage }
 */
const HOSTS = { practice: "api-fxpractice.oanda.com", live: "api-fxtrade.oanda.com" } as const;
const GRAN: Record<Granularity, string> = { H1: "H1", H4: "H4", D1: "D" };

const num = z.string().transform((s, ctx) => {
  const n = Number(s);
  if (!Number.isFinite(n)) ctx.addIssue({ code: "custom", message: "not a number" });
  return n;
});
const body = z.object({
  candles: z.array(z.object({
    time: num,
    mid: z.object({ o: num, h: num, l: num, c: num }),
    complete: z.boolean(),
  })),
});

export class OandaProvider implements MarketDataProvider {
  readonly id = "oanda";
  readonly label: string;
  readonly minIntervalMs = 250;
  readonly batchSize = 40;
  readonly #token: string;
  readonly #host: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(opts: { token: string; env: "practice" | "live"; fetch?: FetchLike; timeoutMs?: number }) {
    this.#token = opts.token;
    this.#host = HOSTS[opts.env];
    this.#fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.#timeoutMs = opts.timeoutMs ?? 20_000;
    this.label = `OANDA (${opts.env})`;
  }

  instrumentFor(symbol: string) {
    return oandaInstrument(symbol);
  }

  async candles(instrument: string, granularity: Granularity, from: Date, to: Date): Promise<Candle[]> {
    const q = new URLSearchParams({ price: "M", granularity: GRAN[granularity], from: (from.getTime() / 1000).toFixed(0), to: (to.getTime() / 1000).toFixed(0) });
    const url = `https://${this.#host}/v3/instruments/${encodeURIComponent(instrument)}/candles?${q}`;
    const res = await fetchWithTimeout(this.#fetch, url, { headers: { Authorization: `Bearer ${this.#token}`, "Accept-Datetime-Format": "UNIX" } }, this.#timeoutMs, "OANDA");
    let json: unknown = null;
    try { json = await res.json(); } catch { /* handled below */ }
    if (!res.ok) throw blockedOnTheWay(res.status, json, "OANDA", this.#host) ?? this.#error(res.status, instrument, json);
    const parsed = body.safeParse(json);
    if (!parsed.success) throw new MarketDataError("bad_response", "OANDA returned candles in an unexpected format.");
    return parsed.data.candles.map((c) => ({ t: Math.round(c.time * 1000), o: c.mid.o, h: c.mid.h, l: c.mid.l, c: c.mid.c, complete: c.complete }));
  }

  #error(status: number, instrument: string, json: unknown) {
    const msg = safeText((json as { errorMessage?: unknown } | null)?.errorMessage, this.#token);
    if (status === 401 || status === 403) return new MarketDataError("auth", `OANDA rejected the API token (HTTP ${status}). Check OANDA_API_TOKEN, and that OANDA_ENV matches the account (${this.label.includes("live") ? "live" : "practice"} is set).`);
    if (status === 429) return new MarketDataError("rate_limit", "OANDA's rate limit was reached. Try again in a minute.");
    if (status === 404 || (status === 400 && /instrument/i.test(msg))) return new MarketDataError("not_found", `OANDA has no candles for ${instrument} on this account${msg ? ` (${msg})` : ""}.`);
    if (status === 400) return new MarketDataError("bad_request", `OANDA rejected the candle request${msg ? `: ${msg}` : ""}.`);
    if (status >= 500) return new MarketDataError("network", `OANDA is unavailable right now (HTTP ${status}). Try again later.`);
    return new MarketDataError("bad_response", `OANDA answered with HTTP ${status}.`);
  }
}
