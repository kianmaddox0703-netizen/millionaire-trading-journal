import type { Candle } from "@/domain/marketContext";

/**
 * The only thing the rest of the app knows about a market-data source. OANDA and Twelve Data
 * implement it; swapping providers is a config change (MARKET_DATA_PROVIDER).
 */
export interface MarketDataProvider {
  readonly id: string;
  /** Shown in the UI, e.g. "OANDA (practice)". Never contains credentials. */
  readonly label: string;
  /** Minimum spacing between requests, to stay inside the provider's rate limit. */
  readonly minIntervalMs: number;
  /** How many trades one background run or one button click may fetch. */
  readonly batchSize: number;
  /** Provider instrument for a journal symbol, or null when it can't be mapped. */
  instrumentFor(symbol: string): string | null;
  /** Mid-price candles whose start time lies in [from, to], ascending. */
  candles(instrument: string, granularity: Granularity, from: Date, to: Date): Promise<Candle[]>;
}

export type Granularity = "H1" | "H4" | "D1";

export type MarketDataErrorKind = "auth" | "rate_limit" | "not_found" | "bad_request" | "network" | "bad_response";

/** A provider failure with a message that is safe to show and store (no tokens, no URLs). */
export class MarketDataError extends Error {
  constructor(readonly kind: MarketDataErrorKind, message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** fetch with a timeout; transport failures become MarketDataError("network"). */
export async function fetchWithTimeout(fetchFn: FetchLike, url: string, init: RequestInit, timeoutMs: number, who: string): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new MarketDataError("network", `${who} didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`);
    throw new MarketDataError("network", `Couldn't reach ${who}. Check the server's network access.`);
  }
}

/**
 * A 403/407 whose body isn't the provider's JSON error came from something in between (a proxy or firewall
 * that doesn't allow the host), not from the provider. Reported as a network problem so a blocked host isn't
 * mistaken for a rejected credential.
 */
export function blockedOnTheWay(status: number, json: unknown, who: string, host: string): MarketDataError | null {
  if ((status !== 403 && status !== 407) || json !== null) return null;
  return new MarketDataError("network", `The request was blocked before ${who} answered (HTTP ${status}, with no error message from ${who}). This usually means the server's network doesn't allow ${host}.`);
}

/** Provider error text, trimmed and with the credential removed in case a provider ever echoes it. */
export function safeText(s: unknown, secret: string) {
  if (typeof s !== "string") return "";
  const t = secret ? s.split(secret).join("[redacted]") : s;
  return t.replace(/\s+/g, " ").trim().slice(0, 160);
}
