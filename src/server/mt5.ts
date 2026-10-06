/**
 * MT5 bridge: per-account API keys and ingestion of deals posted by bridge/mt5_bridge.py.
 * The bridge is read-only on the trader's PC; this side only stores deals and rebuilds trades.
 * Keys are shown once and stored as SHA-256 hashes.
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { newId } from "./ids";
import { randomToken, sha256 } from "./tokens";
import { NotFoundError } from "./trades";
import { createFromImport, existingForAccount, mergeIntoTrade, refreshFrom, tradesByRef } from "./importer";
import { matchAlertsForUser } from "./tradingview";
import { aggregateMt5, findDuplicate, wallClockToUtc, type ImportedTrade, type Mt5Deal } from "@/domain/importing";

const C = schema.brokerConnections, D = schema.mt5Deals;
export const MAX_INGEST_BYTES = 5 * 1024 * 1024;

export function createBridgeKey(userId: string, accountId: string, label: string): string {
  if (!db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId))).get())
    throw new NotFoundError("Account not found");
  const key = `mtj_${randomToken(32)}`;
  db.insert(C).values({ id: newId(), userId, accountId, kind: "mt5_bridge", label: label.slice(0, 60), apiKeyHash: sha256(key) }).run();
  return key;
}

export function bridgeConnections(userId: string) {
  return db.select({ id: C.id, label: C.label, accountId: C.accountId, accountName: schema.accounts.name, lastSeenAt: C.lastSeenAt, createdAt: C.createdAt })
    .from(C).innerJoin(schema.accounts, eq(schema.accounts.id, C.accountId)).where(eq(C.userId, userId)).all();
}

export function revokeBridgeKey(userId: string, id: string) {
  db.delete(C).where(and(eq(C.id, id), eq(C.userId, userId))).run();
}

export function connectionForKey(key: string) {
  if (!/^mtj_[A-Za-z0-9_-]{20,80}$/.test(key)) return null;
  return db.select().from(C).where(eq(C.apiKeyHash, sha256(key))).get() ?? null;
}

const id = z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]).transform(String);
const num = z.number().finite();
const dealSchema = z.object({
  ticket: id, order: id.nullish(), position_id: id,
  time: z.number().int().positive(), time_msc: z.number().int().positive().nullish(),
  type: z.number().int(), entry: z.number().int(),
  symbol: z.string().max(40), volume: num.nonnegative(), price: num.nonnegative(),
  commission: num.default(0), swap: num.default(0), profit: num.default(0), fee: num.default(0),
  sl: num.nullish(), tp: num.nullish(), magic: z.number().int().nullish(), comment: z.string().max(200).nullish(),
});
const orderSchema = z.object({ ticket: id, position_id: id, sl: num.nullish(), tp: num.nullish() });
export const ingestSchema = z.object({
  server_time_zone: z.string().max(40).default("BROKER_NY7"),
  deals: z.array(dealSchema).max(5000),
  orders: z.array(orderSchema).max(5000).default([]),
});
export type IngestPayload = z.infer<typeof ingestSchema>;

// MetaTrader5 enums: DEAL_TYPE_BUY = 0, DEAL_TYPE_SELL = 1; DEAL_ENTRY_IN/OUT/INOUT/OUT_BY = 0/1/2/3
const DEAL_TYPE: Record<number, string> = { 0: "buy", 1: "sell" };
const DEAL_ENTRY: Record<number, string> = { 0: "in", 1: "out", 2: "inout", 3: "out_by" };

function validZone(z: string) {
  if (z === "BROKER_NY7" || z === "UTC") return true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
}

const changed = (row: typeof schema.trades.$inferSelect, t: ImportedTrade) => {
  const diff = (a: number | null, b: number | null) => (a ?? 0) !== (b ?? 0) && Math.abs((a ?? 0) - (b ?? 0)) > 1e-9;
  return row.status !== t.status || (row.closedAt?.getTime() ?? null) !== (t.closedAt?.getTime() ?? null) || row.openedAt.getTime() !== t.openedAt.getTime()
    || diff(row.entryPrice, t.entryPrice) || diff(row.exitPrice, t.exitPrice) || diff(row.sizeLots, t.sizeLots)
    || diff(row.grossPnl, t.grossPnl) || diff(row.commission, t.commission) || diff(row.swap, t.swap);
};

export interface IngestResult { deals: number; created: number; updated: number; unchanged: number; tradeIds: string[] }

export function ingestMt5(conn: { id: string; userId: string; accountId: string }, p: IngestPayload): IngestResult {
  if (!validZone(p.server_time_zone)) throw new Error("Unknown server_time_zone");
  const { userId, accountId } = conn;
  // the opening order's ticket equals the position ID; its SL/TP are the stops set at entry
  const stops = new Map(p.orders.filter((o) => o.ticket === o.position_id).map((o) => [o.position_id, o]));
  const tradeDeals = p.deals.filter((d) => DEAL_TYPE[d.type] && DEAL_ENTRY[d.entry]);
  db.transaction((tx) => {
    for (const d of tradeDeals) {
      const st = d.entry === 0 ? stops.get(d.position_id) : undefined;
      tx.insert(D).values({
        id: newId(), userId, accountId, ticket: d.ticket, positionId: d.position_id, orderId: d.order ?? null,
        time: wallClockToUtc(d.time_msc ?? d.time * 1000, p.server_time_zone),
        type: DEAL_TYPE[d.type], entry: DEAL_ENTRY[d.entry], symbol: d.symbol, volume: d.volume, price: d.price,
        sl: (st?.sl || d.sl) || null, tp: (st?.tp || d.tp) || null,
        commission: d.commission + d.fee, swap: d.swap, profit: d.profit, magic: d.magic ?? null, comment: d.comment ?? null,
      }).onConflictDoNothing().run();
    }
  });

  const positions = [...new Set(tradeDeals.map((d) => d.position_id))];
  const res: IngestResult = { deals: tradeDeals.length, created: 0, updated: 0, unchanged: 0, tradeIds: [] };
  let earliest: Date | null = null;
  if (positions.length) {
    const stored = db.select().from(D).where(and(eq(D.accountId, accountId), inArray(D.positionId, positions))).all();
    const deals: Mt5Deal[] = stored.map((d) => ({ ...d, orderId: d.orderId }));
    const trades = aggregateMt5(deals);
    const byRef = new Map(tradesByRef(userId, accountId, trades.map((t) => t.externalRef!)).map((r) => [r.externalRef!, r]));
    const unref = existingForAccount(userId, accountId).filter((e) => !e.externalRef);
    for (const t of trades) {
      const row = byRef.get(t.externalRef!);
      if (row && !changed(row, t)) { res.unchanged++; continue; }
      const target = row?.id ?? findDuplicate(t, unref)?.trade.id;
      if (target) { mergeIntoTrade(userId, target, t); res.updated++; res.tradeIds.push(target); }
      else { res.tradeIds.push(createFromImport(userId, accountId, t, "mt5_bridge", { strategyId: null, setupId: null })); res.created++; }
      if (!earliest || t.openedAt < earliest) earliest = t.openedAt;
    }
  }
  refreshFrom(userId, accountId, earliest);
  if (res.created + res.updated) matchAlertsForUser(userId);
  db.update(C).set({ lastSeenAt: new Date() }).where(eq(C.id, conn.id)).run();
  return res;
}
