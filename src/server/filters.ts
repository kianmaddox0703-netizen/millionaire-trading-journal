import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import type { EnrichedTrade } from "./analytics";
import { MISTAKES } from "@/domain/mistakes";
import { SESSIONS } from "@/domain/sessions";
import type { FilterOptions } from "@/components/FilterBar";

export function filterOptions(userId: string, trades: EnrichedTrade[]): FilterOptions {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    symbols: uniq(trades.map((t) => t.symbol)),
    strategies: db.select({ id: schema.strategies.id, name: schema.strategies.name }).from(schema.strategies).where(eq(schema.strategies.userId, userId)).all(),
    setups: db.select({ id: schema.setups.id, name: schema.setups.name }).from(schema.setups).where(and(eq(schema.setups.userId, userId))).all(),
    sessions: SESSIONS.filter((s) => trades.some((t) => t.session === s)),
    timeframes: uniq(trades.map((t) => t.timeframe)),
    emotions: uniq(trades.flatMap((t) => [t.emotionBefore, t.emotionDuring, t.emotionAfter])),
    mistakes: MISTAKES.map((m) => ({ key: m.key, label: m.label })),
  };
}
