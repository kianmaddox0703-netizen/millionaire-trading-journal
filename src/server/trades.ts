import { and, eq, inArray, lt, max, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { newId } from "./ids";
import { computeTrade } from "@/domain/metrics";
import { detectMistakes, type DetectTrade, type RiskRules } from "@/domain/mistakes";
import { sessionOf } from "@/domain/sessions";
import type { TradeInput } from "@/domain/validation";
import { FXALEXG_KB, FXALEXG_TEMPLATE } from "@/domain/kb/fxalexg";
import { setupScore } from "@/domain/score";

const T = schema.trades;

export class NotFoundError extends Error {}

// ───────────── bootstrap ─────────────

export function ensureKb() {
  db.transaction((tx) => {
    for (const c of FXALEXG_KB) {
      const row = {
        slug: c.slug, name: c.name, area: c.area, category: c.category, definition: c.definition, confidence: c.confidence,
        related: (c.related ?? []).join(","), exceptions: c.exceptions ?? "", examples: c.examples ?? "",
      };
      tx.insert(schema.kbConcepts).values(row).onConflictDoUpdate({ target: schema.kbConcepts.slug, set: row }).run();
      tx.delete(schema.kbSources).where(eq(schema.kbSources.conceptSlug, c.slug)).run();
      for (const s of c.sources)
        tx.insert(schema.kbSources).values({ id: newId(), conceptSlug: c.slug, kind: s.kind, title: s.title, url: s.url, locator: s.locator ?? "", summary: s.summary }).run();
    }
  });
}

export const DEFAULT_SCORE_FACTORS = [
  { key: "market_context", label: "Market context", weight: 20 },
  { key: "htf_bias", label: "Higher-timeframe bias", weight: 20 },
  { key: "structure", label: "Structure / AOI", weight: 15 },
  { key: "liquidity", label: "Liquidity", weight: 15 },
  { key: "confirmation", label: "Entry confirmation", weight: 15 },
  { key: "risk_reward", label: "Risk / reward", weight: 10 },
  { key: "psychology", label: "Psychology", weight: 5 },
];

export function createFxAlexgStrategy(userId: string) {
  const id = newId();
  db.transaction((tx) => {
    tx.insert(schema.strategies).values({
      id, userId, name: FXALEXG_TEMPLATE.name, description: FXALEXG_TEMPLATE.description, source: "fxalexg_template",
      preferredSessions: FXALEXG_TEMPLATE.preferredSessions, preferredPairs: FXALEXG_TEMPLATE.preferredPairs, preferredConditions: FXALEXG_TEMPLATE.preferredConditions,
    }).run();
    FXALEXG_TEMPLATE.rules.forEach((r, i) =>
      tx.insert(schema.strategyRules).values({ id: newId(), strategyId: id, kind: r.kind, text: r.text, isRequired: r.required, sort: i, kbConceptSlug: r.slug }).run(),
    );
    for (const s of FXALEXG_TEMPLATE.setups) tx.insert(schema.setups).values({ id: newId(), userId, strategyId: id, name: s }).run();
  });
  return id;
}

export function bootstrapUser(userId: string) {
  ensureKb();
  db.insert(schema.accounts).values({ id: newId(), userId, name: "Main Account", kind: "live", startingBalance: 10_000 }).run();
  db.insert(schema.riskRules).values({ id: newId(), userId }).run();
  DEFAULT_SCORE_FACTORS.forEach((f, i) => db.insert(schema.scoreFactors).values({ id: newId(), userId, ...f, sort: i }).run());
  createFxAlexgStrategy(userId);
}

// ───────────── helpers ─────────────

export function getRiskRules(userId: string): RiskRules {
  return db.select().from(schema.riskRules).where(eq(schema.riskRules.userId, userId)).get() ?? {};
}

export function getUserTz(userId: string) {
  return db.select({ tz: schema.users.timezone }).from(schema.users).where(eq(schema.users.id, userId)).get()?.tz ?? "UTC";
}

/** Balance at a moment = starting balance + Σ net P&L of trades closed before it. */
export function balanceAt(userId: string, accountId: string, at: Date, excludeTradeId?: string) {
  const acct = db.select().from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId))).get();
  if (!acct) throw new NotFoundError("Account not found");
  const conds = [eq(T.userId, userId), eq(T.accountId, accountId), lt(T.closedAt, at)];
  if (excludeTradeId) conds.push(sql`${T.id} <> ${excludeTradeId}`);
  const sum = db.select({ s: sql<number>`coalesce(sum(${T.netPnl}), 0)` }).from(T).where(and(...conds)).get();
  return acct.startingBalance + (sum?.s ?? 0);
}

function assertOwned(table: typeof schema.strategies | typeof schema.setups | typeof schema.accounts, id: string | null, userId: string) {
  if (!id) return;
  const row = db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.userId, userId))).get();
  if (!row) throw new NotFoundError("Referenced record not found");
}

function toDetect(t: typeof T.$inferSelect, psych?: typeof schema.tradePsychology.$inferSelect | null): DetectTrade {
  return {
    id: t.id, openedAt: t.openedAt, closedAt: t.closedAt, netPnl: t.netPnl, rMultiple: t.rMultiple, riskPct: t.riskPct, riskAmount: t.riskAmount,
    plannedRr: t.plannedRr, strategyId: t.strategyId, setupQuality: t.setupQuality, direction: t.direction, htfBias: t.htfBias, psych,
  };
}

/** Recompute rule-based mistakes for one trade (user-tagged mistakes are kept). */
export function refreshRuleMistakes(userId: string, tradeId: string) {
  const t = db.select().from(T).where(and(eq(T.id, tradeId), eq(T.userId, userId))).get();
  if (!t) return;
  const psych = db.select().from(schema.tradePsychology).where(eq(schema.tradePsychology.tradeId, tradeId)).get();
  const history = db.select().from(T).where(and(eq(T.userId, userId), eq(T.accountId, t.accountId))).all().map((h) => toDetect(h));
  const bal = balanceAt(userId, t.accountId, t.openedAt, t.id);
  const found = detectMistakes(toDetect(t, psych), history, getRiskRules(userId), bal, getUserTz(userId));
  const userTagged = new Set(
    db.select({ k: schema.tradeMistakes.mistakeKey }).from(schema.tradeMistakes)
      .where(and(eq(schema.tradeMistakes.tradeId, tradeId), eq(schema.tradeMistakes.source, "user"))).all().map((r) => r.k),
  );
  db.transaction((tx) => {
    tx.delete(schema.tradeMistakes).where(and(eq(schema.tradeMistakes.tradeId, tradeId), sql`${schema.tradeMistakes.source} <> 'user'`)).run();
    for (const m of found) {
      if (userTagged.has(m.key)) {
        tx.update(schema.tradeMistakes).set({ costR: m.costR, note: m.note }).where(and(eq(schema.tradeMistakes.tradeId, tradeId), eq(schema.tradeMistakes.mistakeKey, m.key))).run();
        continue;
      }
      tx.insert(schema.tradeMistakes).values({ id: newId(), tradeId, userId, mistakeKey: m.key, source: m.source, costR: m.costR, note: m.note }).run();
    }
  });
}

// ───────────── save / delete ─────────────

export function saveTrade(userId: string, input: TradeInput, tradeId?: string, opts: { source?: "manual" | "csv" | "mt5_report" | "mt5_bridge"; externalRef?: string | null; refreshLater?: boolean } = {}): string {
  assertOwned(schema.accounts, input.accountId, userId);
  assertOwned(schema.strategies, input.strategyId, userId);
  assertOwned(schema.setups, input.setupId, userId);
  if (tradeId && !db.select({ id: T.id }).from(T).where(and(eq(T.id, tradeId), eq(T.userId, userId))).get()) throw new NotFoundError("Trade not found");

  const openedAt = input.openedAt as Date;
  const balance = balanceAt(userId, input.accountId, openedAt, tradeId);
  const closed = input.status === "closed";
  const d = computeTrade({
    direction: input.direction, entryPrice: input.entryPrice, initialStop: input.initialStop, takeProfit: input.takeProfit,
    exitPrice: closed ? input.exitPrice : null, grossPnl: closed ? input.grossPnl : null, netPnl: closed ? input.netPnl : null,
    commission: input.commission, swap: input.swap, fees: input.fees, riskAmount: input.riskAmount, balanceAtEntry: balance,
  });

  const factors = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, userId)).all();
  const score = setupScore(factors, input.factors);

  const values = {
    accountId: input.accountId, strategyId: input.strategyId, setupId: input.setupId,
    symbol: input.symbol, direction: input.direction, status: input.status, openedAt, closedAt: closed ? input.closedAt : null,
    entryPrice: input.entryPrice, initialStop: input.initialStop, takeProfit: input.takeProfit, exitPrice: closed ? input.exitPrice : null,
    sizeLots: input.sizeLots, riskAmount: d.riskAmount, riskPct: d.riskPct, grossPnl: d.grossPnl,
    commission: input.commission ?? 0, swap: input.swap ?? 0, fees: input.fees ?? 0,
    netPnl: d.netPnl, pnlPct: d.pnlPct, rMultiple: d.rMultiple, plannedRr: d.plannedRr,
    session: input.session || sessionOf(openedAt), timeframe: input.timeframe, marketCondition: input.marketCondition, trend: input.trend, htfBias: input.htfBias,
    setupQuality: input.setupQuality, entryConfirmation: input.entryConfirmation, confluences: input.confluences, chartUrl: input.chartUrl,
    setupScore: score,
    updatedAt: new Date(),
  };

  const id = tradeId ?? newId();
  db.transaction((tx) => {
    if (tradeId) tx.update(T).set(values).where(and(eq(T.id, tradeId), eq(T.userId, userId))).run();
    else {
      const seq = (tx.select({ m: max(T.seq) }).from(T).where(eq(T.userId, userId)).get()?.m ?? 0) + 1;
      tx.insert(T).values({ id, userId, seq, source: opts.source ?? "manual", externalRef: opts.externalRef ?? null, ...values }).run();
    }

    const n = input.notes;
    const notes = { why: n.why ?? "", observed: n.observed ?? "", thesis: n.thesis ?? "", whatHappened: n.whatHappened ?? "", didWell: n.didWell ?? "", didPoorly: n.didPoorly ?? "", wouldChange: n.wouldChange ?? "", lesson: n.lesson ?? "" };
    tx.insert(schema.tradeNotes).values({ tradeId: id, userId, ...notes }).onConflictDoUpdate({ target: schema.tradeNotes.tradeId, set: { ...notes, updatedAt: new Date() } }).run();

    const p = input.psych;
    const psych = {
      confidence: p.confidence ?? null, discipline: p.discipline ?? null, followedPlan: p.followedPlan ?? null,
      fomo: !!p.fomo, revenge: !!p.revenge, movedStop: !!p.movedStop, exitedEarly: !!p.exitedEarly, overtraded: !!p.overtraded, lateEntry: !!p.lateEntry, oversized: !!p.oversized,
    };
    tx.insert(schema.tradePsychology).values({ tradeId: id, userId, ...psych }).onConflictDoUpdate({ target: schema.tradePsychology.tradeId, set: psych }).run();

    tx.delete(schema.psychologyEntries).where(eq(schema.psychologyEntries.tradeId, id)).run();
    const e = input.emotions;
    for (const phase of ["before", "during", "after"] as const) {
      const emotion = e[phase];
      if (emotion) tx.insert(schema.psychologyEntries).values({ id: newId(), tradeId: id, userId, phase, emotion, intensity: e[`${phase}Intensity`] ?? null }).run();
    }

    // user-tagged mistakes (psych flags are also detected as user mistakes in refreshRuleMistakes)
    tx.delete(schema.tradeMistakes).where(and(eq(schema.tradeMistakes.tradeId, id), eq(schema.tradeMistakes.source, "user"))).run();
    for (const k of new Set(input.mistakes)) tx.insert(schema.tradeMistakes).values({ id: newId(), tradeId: id, userId, mistakeKey: k, source: "user" }).run();

    tx.delete(schema.tradeFactorRatings).where(eq(schema.tradeFactorRatings.tradeId, id)).run();
    for (const [factorKey, rating] of Object.entries(input.factors))
      if (rating !== null && factors.some((f) => f.key === factorKey))
        tx.insert(schema.tradeFactorRatings).values({ id: newId(), tradeId: id, userId, factorKey, rating }).run();

    if (input.checklist.length) {
      tx.delete(schema.checklistResponses).where(eq(schema.checklistResponses.tradeId, id)).run();
      input.checklist.forEach((c, i) => tx.insert(schema.checklistResponses).values({ id: newId(), tradeId: id, userId, phase: c.phase, item: c.item, checked: c.checked, answer: c.answer, sort: i }).run());
    }
  });

  // psych flags → user mistakes, then rule mistakes
  const flagMap: Record<string, string> = { fomo: "fomo", revenge: "revenge", movedStop: "moved_stop", exitedEarly: "early_exit", overtraded: "overtrading", lateEntry: "late_entry", oversized: "oversized" };
  for (const [flag, key] of Object.entries(flagMap)) {
    if ((input.psych as Record<string, unknown>)[flag])
      db.insert(schema.tradeMistakes).values({ id: newId(), tradeId: id, userId, mistakeKey: key, source: "user" }).onConflictDoNothing().run();
  }
  refreshRuleMistakes(userId, id);
  // later trades in the same account may depend on this one (balance, daily counts)
  if (opts.refreshLater === false) return id;
  const later = db.select({ id: T.id }).from(T).where(and(eq(T.userId, userId), eq(T.accountId, input.accountId), sql`${T.openedAt} > ${openedAt.getTime()}`)).limit(50).all();
  for (const l of later) refreshRuleMistakes(userId, l.id);
  return id;
}

export function deleteTrade(userId: string, tradeId: string) {
  const res = db.delete(T).where(and(eq(T.id, tradeId), eq(T.userId, userId))).run();
  if (res.changes === 0) throw new NotFoundError("Trade not found");
}

export function tradeIdsOwned(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: T.id }).from(T).where(and(eq(T.userId, userId), inArray(T.id, ids))).all().map((r) => r.id);
}
