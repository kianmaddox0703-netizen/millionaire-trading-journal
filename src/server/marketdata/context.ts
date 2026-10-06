import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { SaveOrigin } from "../hooks";
import { CONTEXT_VERSION, HOUR, LOOKBACK_DAYS, computeContext, inputOf, parseContextDetails, sameInput, type ContextDetails } from "@/domain/marketContext";
import { activeProvider, throttle } from "./provider";
import { MarketDataError, type MarketDataProvider } from "./types";

/**
 * Automatic market context per trade: one H1 candle request per trade, computed at entry with
 * no lookahead (src/domain/marketContext.ts) and stored in market_context. Every query is
 * filtered by the signed-in user's id. Nothing runs unless a provider is configured.
 */

type TradeRow = { id: string; symbol: string; openedAt: Date; entryPrice: number };
type Row = typeof schema.marketContext.$inferSelect;
export type ContextStatus = Row["status"];
export interface StoredContext extends Omit<Row, "details"> { details: ContextDetails | null }
/** ok but computed from an older version of the trade (or of the definitions). */
export type TradeContextState = ContextStatus | "stale" | "none";

const EMPTY = { trend: null, htfBias: null, session: null, volatility: null, atr: null, nearKeyLevel: null } as const;
const tradeCols = { id: schema.trades.id, symbol: schema.trades.symbol, openedAt: schema.trades.openedAt, entryPrice: schema.trades.entryPrice };

function upsert(userId: string, tradeId: string, v: Omit<typeof schema.marketContext.$inferInsert, "tradeId" | "userId" | "computedAt">) {
  const set = { ...v, computedAt: new Date() };
  db.insert(schema.marketContext).values({ tradeId, userId, ...set })
    .onConflictDoUpdate({ target: schema.marketContext.tradeId, set, setWhere: eq(schema.marketContext.userId, userId) }).run();
}

const detailsJson = (t: TradeRow, computed: ContextDetails["computed"] = null) => JSON.stringify({ v: CONTEXT_VERSION, input: inputOf(t), computed } satisfies ContextDetails);

/** providerId: the active provider, so a symbol that an earlier provider couldn't map is tried again after a switch. */
export function stateOf(row: StoredContext | undefined, t: TradeRow, providerId: string | null = null): TradeContextState {
  if (!row) return "none";
  if (row.status === "unsupported" && providerId && row.provider !== providerId) return "stale";
  const current = !!row.details && row.details.v === CONTEXT_VERSION && sameInput(row.details.input, inputOf(t));
  if (row.status === "ok" || row.status === "unsupported") return current ? row.status : "stale";
  return row.status;
}

function toStored(r: Row): StoredContext {
  return { ...r, details: parseContextDetails(r.details) };
}

export function contextFor(userId: string, tradeId: string): StoredContext | null {
  const r = db.select().from(schema.marketContext).where(and(eq(schema.marketContext.userId, userId), eq(schema.marketContext.tradeId, tradeId))).get();
  return r ? toStored(r) : null;
}

export function contextsByTrade(userId: string, tradeIds?: string[]): Map<string, StoredContext> {
  const out = new Map<string, StoredContext>();
  const chunks = tradeIds ? Array.from({ length: Math.ceil(tradeIds.length / 500) }, (_, i) => tradeIds.slice(i * 500, i * 500 + 500)) : [null];
  for (const ids of chunks) {
    const where = ids ? and(eq(schema.marketContext.userId, userId), inArray(schema.marketContext.tradeId, ids)) : eq(schema.marketContext.userId, userId);
    for (const r of db.select().from(schema.marketContext).where(where).all()) out.set(r.tradeId, toStored(r));
  }
  return out;
}

function userTrades(userId: string, ids?: string[]): TradeRow[] {
  if (!ids) return db.select(tradeCols).from(schema.trades).where(eq(schema.trades.userId, userId)).all();
  const out: TradeRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...db.select(tradeCols).from(schema.trades).where(and(eq(schema.trades.userId, userId), inArray(schema.trades.id, ids.slice(i, i + 500)))).all());
  }
  return out;
}

/** Counts per state for the user's trades (for the Market Analysis status line). */
export function contextCounts(userId: string) {
  const ctx = contextsByTrade(userId);
  const counts: Record<TradeContextState, number> = { ok: 0, stale: 0, pending: 0, error: 0, unsupported: 0, none: 0 };
  const trades = userTrades(userId);
  const pid = activeProvider()?.id ?? null;
  for (const t of trades) counts[stateOf(ctx.get(t.id), t, pid)]++;
  return { ...counts, total: trades.length, missing: counts.none + counts.stale + counts.pending + counts.error };
}

// ───────────── fetching ─────────────

type Outcome = { status: ContextStatus; stop?: MarketDataError };

async function processTrade(p: MarketDataProvider, userId: string, t: TradeRow): Promise<Outcome> {
  const instrument = p.instrumentFor(t.symbol);
  if (!instrument) {
    const covers = p.id === "oanda" ? "FX pairs, metals and some OANDA index, energy and crypto CFDs" : "FX pairs, gold, silver, WTI and major crypto pairs";
    upsert(userId, t.id, { ...EMPTY, provider: p.id, instrument: null, status: "unsupported", error: `${t.symbol} has no ${p.label} instrument mapping, so no candles are fetched. Automatic context covers ${covers}.`, details: detailsJson(t) });
    return { status: "unsupported" };
  }
  const base = { provider: p.id, instrument };
  try {
    const entry = t.openedAt.getTime();
    const to = Math.min(entry, Date.now());
    await throttle(p);
    const candles = await p.candles(instrument, "H1", new Date(to - LOOKBACK_DAYS * 24 * HOUR), new Date(to));
    const r = computeContext(candles, entry, t.entryPrice);
    if (!r.ok) {
      upsert(userId, t.id, { ...EMPTY, ...base, status: "error", error: `${r.reason} The provider may not have history this far back for ${instrument}.`, details: detailsJson(t) });
      return { status: "error" };
    }
    const v = r.value;
    upsert(userId, t.id, {
      ...base, status: "ok", error: null, trend: v.trend, htfBias: v.htfBias, session: v.session, volatility: v.volatility, atr: v.atr, nearKeyLevel: v.nearKeyLevel,
      details: detailsJson(t, v.details),
    });
    return { status: "ok" };
  } catch (e) {
    if (e instanceof MarketDataError) {
      if (e.kind === "rate_limit") {
        upsert(userId, t.id, { ...EMPTY, ...base, status: "pending", error: e.message, details: detailsJson(t) });
        return { status: "pending", stop: e };
      }
      upsert(userId, t.id, { ...EMPTY, ...base, status: "error", error: e.message, details: detailsJson(t) });
      // a bad token or no network fails every request; don't burn through the rest of the batch
      return { status: "error", stop: e.kind === "auth" || e.kind === "network" ? e : undefined };
    }
    console.error("market context failed:", e instanceof Error ? e.message : "unknown error");
    upsert(userId, t.id, { ...EMPTY, ...base, status: "error", error: "Computing the market context failed. Try Refresh.", details: detailsJson(t) });
    return { status: "error" };
  }
}

export interface RunResult { ok: number; error: number; unsupported: number; pending: number; fetched: number; stopped: string | null }

/** Processes trades in order: unmapped symbols cost no request; at most `limit` requests are made. */
async function run(p: MarketDataProvider, userId: string, trades: TradeRow[], limit: number, markRestPending: boolean): Promise<RunResult> {
  const res: RunResult = { ok: 0, error: 0, unsupported: 0, pending: 0, fetched: 0, stopped: null };
  const rest: TradeRow[] = [];
  for (const t of trades) {
    const mapped = p.instrumentFor(t.symbol) !== null;
    if (mapped && (res.fetched >= limit || res.stopped)) { rest.push(t); continue; }
    const r = await processTrade(p, userId, t);
    res[r.status]++;
    if (mapped) res.fetched++;
    if (r.stop) res.stopped = r.stop.message;
  }
  if (markRestPending && rest.length) {
    // re-read first: another run (a click on Fetch) may have computed some of these while this one was fetching
    const now = contextsByTrade(userId, rest.map((t) => t.id));
    for (const t of rest) {
      const s = stateOf(now.get(t.id), t, p.id);
      if (s === "ok" || s === "unsupported") continue;
      upsert(userId, t.id, { ...EMPTY, provider: p.id, instrument: p.instrumentFor(t.symbol), status: "pending", error: null, details: detailsJson(t) });
    }
  }
  return res;
}

const newestFirst = (a: TradeRow, b: TradeRow) => b.openedAt.getTime() - a.openedAt.getTime();

/**
 * After trades are saved. No-op without a provider. Trades whose stored context still matches
 * their symbol, entry time and price are skipped; errors are only retried on a manual save (or
 * from the Market Analysis button) so a bridge sync doesn't repeat a failing request every time.
 * At most one provider batch is fetched; the rest are stored as "pending". Never throws.
 */
export async function refreshContextForTrades(userId: string, tradeIds: string[], origin: SaveOrigin): Promise<void> {
  try {
    const p = activeProvider();
    if (!p || !tradeIds.length) return;
    const trades = userTrades(userId, [...new Set(tradeIds)]);
    const ctx = contextsByTrade(userId, trades.map((t) => t.id));
    const todo = trades.filter((t) => {
      const row = ctx.get(t.id), s = stateOf(row, t, p.id);
      const edited = !row?.details || !sameInput(row.details.input, inputOf(t));
      return s === "none" || s === "stale" || s === "pending" || (s === "error" && (origin === "manual" || edited));
    });
    await run(p, userId, todo.sort(newestFirst), p.batchSize, true);
  } catch (e) {
    console.error("market context refresh failed:", e instanceof Error ? e.message : "unknown error");
  }
}

/** Fetch for the user's trades that have no current context (Market Analysis button). */
export async function fetchMissingContext(userId: string): Promise<RunResult & { remaining: number }> {
  const p = activeProvider();
  if (!p) return { ok: 0, error: 0, unsupported: 0, pending: 0, fetched: 0, stopped: "No market-data provider is configured.", remaining: contextCounts(userId).missing };
  const trades = userTrades(userId);
  const ctx = contextsByTrade(userId);
  const rank = (t: TradeRow) => ({ none: 0, pending: 0, stale: 1, error: 2, ok: 9, unsupported: 9 })[stateOf(ctx.get(t.id), t, p.id)];
  const todo = trades.filter((t) => rank(t) < 9).sort((a, b) => rank(a) - rank(b) || newestFirst(a, b));
  const res = await run(p, userId, todo, p.batchSize, false);
  return { ...res, remaining: contextCounts(userId).missing };
}

/** Refresh one trade now, whatever its stored state. The caller has checked ownership via userId. */
export async function refreshTradeContext(userId: string, tradeId: string): Promise<{ status: ContextStatus | null; message: string }> {
  const p = activeProvider();
  if (!p) return { status: null, message: "No market-data provider is configured." };
  const [t] = userTrades(userId, [tradeId]);
  if (!t) return { status: null, message: "Trade not found." };
  const r = await processTrade(p, userId, t);
  const row = contextFor(userId, tradeId);
  return { status: r.status, message: r.status === "ok" ? "Market context updated." : row?.error ?? "Market context could not be computed." };
}
