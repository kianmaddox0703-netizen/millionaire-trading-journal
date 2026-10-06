import { config } from "../config";
import { OandaProvider } from "./oanda";
import { TwelveDataProvider } from "./twelvedata";
import type { MarketDataProvider } from "./types";

/** Which provider is configured, and what is missing if it can't be used. Safe to show (no secrets). */
export interface ProviderStatus { id: string; ready: boolean; label: string; problem: string | null }

let override: MarketDataProvider | null = null;
let cached: { sig: string; provider: MarketDataProvider } | null = null;

/** Test seam (a labelled test double in tests/marketdata.test.ts). Pass null to restore config. */
export function setMarketDataProviderForTests(p: MarketDataProvider | null) {
  override = p;
}

export function providerStatus(): ProviderStatus {
  if (override) return { id: override.id, ready: true, label: override.label, problem: null };
  const id = config.marketDataProvider();
  if (id === "oanda") {
    const label = `OANDA (${config.oandaEnv()})`;
    return config.oandaToken() ? { id, ready: true, label, problem: null } : { id, ready: false, label, problem: "MARKET_DATA_PROVIDER is oanda but OANDA_API_TOKEN is empty on the server." };
  }
  if (id === "twelvedata") {
    return config.twelveDataKey() ? { id, ready: true, label: "Twelve Data", problem: null } : { id, ready: false, label: "Twelve Data", problem: "MARKET_DATA_PROVIDER is twelvedata but TWELVEDATA_API_KEY is empty on the server." };
  }
  return { id: "none", ready: false, label: "Not configured", problem: null };
}

/** The configured provider, or null when none is set up. Credentials stay inside the client object. */
export function activeProvider(): MarketDataProvider | null {
  if (override) return override;
  const s = providerStatus();
  if (!s.ready) return null;
  const secret = s.id === "oanda" ? config.oandaToken() : config.twelveDataKey();
  const sig = `${s.id}|${config.oandaEnv()}|${secret}`; // in memory only, like the AI client cache
  if (cached?.sig !== sig) {
    cached = { sig, provider: s.id === "oanda" ? new OandaProvider({ token: secret, env: config.oandaEnv() }) : new TwelveDataProvider({ apiKey: secret }) };
  }
  return cached.provider;
}

// Requests are spaced per provider across everything running in this server process.
const nextSlot = new Map<string, number>();

export async function throttle(p: MarketDataProvider) {
  if (p.minIntervalMs <= 0) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(p.id) ?? 0);
  nextSlot.set(p.id, at + p.minIntervalMs);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
