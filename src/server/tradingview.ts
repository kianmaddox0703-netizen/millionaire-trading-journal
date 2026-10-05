/**
 * TradingView webhook tokens, alert storage and alert ↔ trade links.
 * The webhook URL carries a random token (TradingView cannot send custom headers); only its
 * SHA-256 hash is stored, so a database leak does not reveal working webhook URLs.
 */
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { newId } from "./ids";
import { randomToken, sha256 } from "./tokens";
import { NotFoundError } from "./trades";
import { bestTradeFor, parseAlertBody, AUTO_LINK, MATCH_AFTER_MS, MATCH_BEFORE_MS } from "@/domain/matching";

const A = schema.tradingviewAlerts, L = schema.tradeLinks, T = schema.trades, W = schema.webhookTokens;
export const MAX_ALERT_BYTES = 10_000;

export function createWebhookToken(userId: string): string {
  const token = randomToken(32);
  db.transaction((tx) => {
    tx.delete(W).where(and(eq(W.userId, userId), eq(W.kind, "tradingview"))).run();
    tx.insert(W).values({ id: newId(), userId, kind: "tradingview", tokenHash: sha256(token) }).run();
  });
  return token;
}

export function webhookStatus(userId: string) {
  return db.select({ createdAt: W.createdAt }).from(W).where(and(eq(W.userId, userId), eq(W.kind, "tradingview"))).get() ?? null;
}

export function revokeWebhookToken(userId: string) {
  db.delete(W).where(and(eq(W.userId, userId), eq(W.kind, "tradingview"))).run();
}

export function userForWebhookToken(token: string): string | null {
  return db.select({ userId: W.userId }).from(W).where(and(eq(W.tokenHash, sha256(token)), eq(W.kind, "tradingview"))).get()?.userId ?? null;
}

export function receiveAlert(userId: string, body: string): string {
  const p = parseAlertBody(body);
  const id = newId();
  db.insert(A).values({ id, userId, ...p, raw: body.slice(0, MAX_ALERT_BYTES) }).run();
  matchAlertsForUser(userId, [id]);
  return id;
}

const alertTime = (a: typeof A.$inferSelect) => a.alertTime ?? a.receivedAt;

/**
 * (Re)computes automatic links for alerts that the trader hasn't linked by hand.
 * Called after an alert arrives and after trades are imported or synced.
 */
export function matchAlertsForUser(userId: string, alertIds?: string[]) {
  const alerts = db.select().from(A).where(alertIds ? and(eq(A.userId, userId), inArray(A.id, alertIds)) : eq(A.userId, userId)).all();
  if (!alerts.length) return;
  const links = db.select().from(L).where(and(eq(L.userId, userId), eq(L.kind, "tv_alert"))).all();
  const rejected = new Set(links.filter((l) => l.status === "rejected").map((l) => `${l.refId}:${l.tradeId}`));
  const manual = new Set(links.filter((l) => l.status === "confirmed" && l.score === null).map((l) => l.refId));
  for (const a of alerts) {
    if (manual.has(a.id)) continue;
    const at = alertTime(a);
    const trades = db.select({ id: T.id, symbol: T.symbol, direction: T.direction, openedAt: T.openedAt, entryPrice: T.entryPrice }).from(T)
      .where(and(eq(T.userId, userId), gte(T.openedAt, new Date(at.getTime() - MATCH_BEFORE_MS)), lte(T.openedAt, new Date(at.getTime() + MATCH_AFTER_MS)))).all();
    const best = bestTradeFor({ id: a.id, symbol: a.symbol, side: a.side, price: a.price, time: at }, trades, rejected);
    db.transaction((tx) => {
      tx.delete(L).where(and(eq(L.userId, userId), eq(L.kind, "tv_alert"), eq(L.refId, a.id), ne(L.status, "rejected"))).run();
      if (best) tx.insert(L).values({ id: newId(), userId, tradeId: best.trade.id, kind: "tv_alert", refId: a.id, score: best.score, status: best.score >= AUTO_LINK ? "confirmed" : "suggested" }).run();
    });
  }
}

function owned(userId: string, tradeId: string, alertId: string) {
  const t = db.select({ id: T.id }).from(T).where(and(eq(T.id, tradeId), eq(T.userId, userId))).get();
  const a = db.select({ id: A.id }).from(A).where(and(eq(A.id, alertId), eq(A.userId, userId))).get();
  if (!t || !a) throw new NotFoundError("Not found");
}

/** Link by hand (or confirm a suggestion). An alert belongs to one trade. */
export function linkAlert(userId: string, tradeId: string, alertId: string) {
  owned(userId, tradeId, alertId);
  db.transaction((tx) => {
    tx.delete(L).where(and(eq(L.userId, userId), eq(L.kind, "tv_alert"), eq(L.refId, alertId), ne(L.status, "rejected"))).run();
    tx.delete(L).where(and(eq(L.tradeId, tradeId), eq(L.kind, "tv_alert"), eq(L.refId, alertId))).run();
    tx.insert(L).values({ id: newId(), userId, tradeId, kind: "tv_alert", refId: alertId, score: null, status: "confirmed" }).run();
  });
}

/** Unlink or reject a suggestion; remembered so automatic matching doesn't link the pair again. */
export function unlinkAlert(userId: string, tradeId: string, alertId: string) {
  owned(userId, tradeId, alertId);
  db.insert(L).values({ id: newId(), userId, tradeId, kind: "tv_alert", refId: alertId, score: null, status: "rejected" })
    .onConflictDoUpdate({ target: [L.tradeId, L.kind, L.refId], set: { status: "rejected", score: null } }).run();
}

export function alertsForTrade(userId: string, tradeId: string) {
  return db.select({ alert: A, link: L }).from(L).innerJoin(A, eq(A.id, L.refId))
    .where(and(eq(L.userId, userId), eq(L.tradeId, tradeId), eq(L.kind, "tv_alert"), ne(L.status, "rejected"))).all();
}

/** Same-symbol alerts within a day of the trade's open that aren't linked to it, for manual linking. */
export function nearbyAlerts(userId: string, trade: { id: string; symbol: string; openedAt: Date }) {
  const day = 86400_000;
  const linked = new Set(alertsForTrade(userId, trade.id).map((r) => r.alert.id));
  const at = sql`coalesce(${A.alertTime}, ${A.receivedAt})`;
  return db.select().from(A).where(and(eq(A.userId, userId), eq(A.symbol, trade.symbol), gte(at, trade.openedAt.getTime() - day), lte(at, trade.openedAt.getTime() + day)))
    .orderBy(desc(at)).limit(20).all().filter((a) => !linked.has(a.id));
}

export function recentAlerts(userId: string, limit = 50) {
  const alerts = db.select().from(A).where(eq(A.userId, userId)).orderBy(desc(A.receivedAt)).limit(limit).all();
  const links = alerts.length
    ? db.select({ refId: L.refId, status: L.status, score: L.score, tradeId: L.tradeId, seq: T.seq }).from(L).innerJoin(T, eq(T.id, L.tradeId))
      .where(and(eq(L.userId, userId), inArray(L.refId, alerts.map((a) => a.id)), ne(L.status, "rejected"))).all()
    : [];
  return alerts.map((a) => ({ ...a, link: links.find((l) => l.refId === a.id) ?? null }));
}
