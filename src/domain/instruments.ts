/**
 * Journal symbol → market-data provider instrument. Pure, tested in tests/marketdata.test.ts.
 *
 * Instrument names come from the providers' own material, nothing is guessed:
 *  - OANDA: v20 InstrumentName is "base and quote delimited by _" (oanda/v20-openapi). The base/quote
 *    names below are the ones in OANDA's "Position limits v20" list (help.oanda.com, January 2026).
 *  - Twelve Data: symbols are "EUR/USD" style (docs and twelvedata-python README). XAU/USD and WTI/USD
 *    appear in the /commodities docs example, XAG/USD and XAU/XAG on twelvedata.com market pages,
 *    BTC/USD as a "digital currency pair". Twelve Data index tickers could not be confirmed, so
 *    indices return null there.
 * A null result means "unsupported": the trade gets no automatic context and the UI says why.
 */
import { normalizeSymbol } from "./importing";

export type InstrumentClass = "fx" | "metal" | "index" | "energy" | "crypto";
export interface Underlying { base: string; quote: string; cls: InstrumentClass }

// Currencies that appear in OANDA's v20 FX pair list.
const FX = new Set(["AUD", "CAD", "CHF", "CNH", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "JPY", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "THB", "TRY", "USD", "ZAR"]);
const METAL_QUOTES = new Set(["USD", "AUD", "CAD", "CHF", "EUR", "GBP", "HKD", "JPY", "NZD", "SGD"]);

// OANDA CFD instruments (base → quote), from the same OANDA list.
const OANDA_CFD: Record<string, [string, InstrumentClass]> = {
  SPX500: ["USD", "index"], NAS100: ["USD", "index"], US30: ["USD", "index"], US2000: ["USD", "index"],
  UK100: ["GBP", "index"], DE30: ["EUR", "index"], FR40: ["EUR", "index"], EU50: ["EUR", "index"],
  JP225: ["USD", "index"], AU200: ["AUD", "index"], HK33: ["HKD", "index"], CN50: ["USD", "index"],
  CH20: ["CHF", "index"], NL25: ["EUR", "index"],
  WTICO: ["USD", "energy"], BCO: ["USD", "energy"], NATGAS: ["USD", "energy"],
  BTC: ["USD", "crypto"], ETH: ["USD", "crypto"], LTC: ["USD", "crypto"], BCH: ["USD", "crypto"],
};

// Common broker names for the same underlyings. Only unambiguous ones.
const ALIAS: Record<string, string> = {
  GOLD: "XAUUSD", SILVER: "XAGUSD",
  US500: "SPX500", SP500: "SPX500", USTEC: "NAS100", US100: "NAS100", DJ30: "US30", WS30: "US30",
  USOIL: "WTICO", WTI: "WTICO", XTIUSD: "WTICO", UKOIL: "BCO", BRENT: "BCO", XBRUSD: "BCO", XNGUSD: "NATGAS",
};

/** "US30.cash" → "US30", "SPX500_USD" → "SPX500USD", "GOLD" → "XAUUSD"; FX via normalizeSymbol. */
function core(symbol: string) {
  let s = normalizeSymbol(symbol);
  if (!/^[A-Z]{6}$/.test(s)) s = s.replace(/_/g, "").replace(/[.#!+-].*$/, "").replace(/CASH$/, "");
  return ALIAS[s] ?? s;
}

export function underlyingOf(symbol: string): Underlying | null {
  const s = core(symbol);
  const m = /^([A-Z]{3})([A-Z]{3})$/.exec(s);
  if (m) {
    const [, b, q] = m;
    if (FX.has(b) && FX.has(q) && b !== q) return { base: b, quote: q, cls: "fx" };
    if ((b === "XAU" || b === "XAG") && (METAL_QUOTES.has(q) || (b === "XAU" && q === "XAG"))) return { base: b, quote: q, cls: "metal" };
    if ((b === "XPT" || b === "XPD" || b === "XCU") && q === "USD") return { base: b, quote: q, cls: "metal" };
  }
  for (const [base, [quote, cls]] of Object.entries(OANDA_CFD)) {
    if (s === base || s === base + quote) return { base, quote, cls };
  }
  return null;
}

export function oandaInstrument(symbol: string): string | null {
  const u = underlyingOf(symbol);
  return u ? `${u.base}_${u.quote}` : null;
}

const TD_METALS = new Set(["XAU/USD", "XAG/USD", "XAU/XAG"]);
const TD_CRYPTO = new Set(["BTC", "ETH", "LTC", "BCH"]);

export function twelveDataSymbol(symbol: string): string | null {
  const u = underlyingOf(symbol);
  if (!u) return null;
  if (u.cls === "fx") return `${u.base}/${u.quote}`;
  if (u.cls === "metal") return TD_METALS.has(`${u.base}/${u.quote}`) ? `${u.base}/${u.quote}` : null;
  if (u.cls === "crypto") return TD_CRYPTO.has(u.base) ? `${u.base}/USD` : null;
  if (u.cls === "energy") return u.base === "WTICO" ? "WTI/USD" : null;
  return null;
}

/** Broker CFD prices for indices, energies and crypto can sit some points away from the provider's. */
export function priceOffsetLikely(symbol: string) {
  const c = underlyingOf(symbol)?.cls;
  return c === "index" || c === "energy" || c === "crypto";
}
