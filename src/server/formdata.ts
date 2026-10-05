import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { userAccounts } from "./analytics";
import { getRiskRules } from "./trades";
import { MISTAKES } from "@/domain/mistakes";
import { EMOTIONS } from "./db/schema";

export const DEFAULT_PRE_CHECKLIST = [
  "Higher timeframe bias identified", "Setup identified", "Entry criteria satisfied", "Confirmation present", "Stop location valid",
  "Risk within limits", "R:R acceptable", "No emotional impulse", "Trade fits my plan",
];
export const POST_CHECKLIST = [
  "Did I follow my plan?", "Did I respect risk?", "Did I manage the trade according to my rules?", "Did emotion affect the execution?", "What would I do differently?",
];

/** Reference data for the trade form, all scoped to the user. */
export function tradeFormData(userId: string) {
  const strategies = db.query.strategies.findMany({
    where: and(eq(schema.strategies.userId, userId), eq(schema.strategies.isActive, true)),
    with: { setups: true, rules: { orderBy: asc(schema.strategyRules.sort) } },
  }).sync();
  return {
    accounts: userAccounts(userId).map((a) => ({ id: a.id, name: a.name, currency: a.currency })),
    strategies: strategies.map((s) => ({
      id: s.id, name: s.name,
      setups: s.setups.map((x) => ({ id: x.id, name: x.name })),
      checklist: s.rules.filter((r) => r.kind === "checklist").map((r) => ({ text: r.text, required: r.isRequired })),
    })),
    factors: db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, userId)).orderBy(asc(schema.scoreFactors.sort)).all().map((f) => ({ key: f.key, label: f.label, weight: f.weight })),
    emotions: [...EMOTIONS],
    mistakes: MISTAKES.map((m) => ({ key: m.key, label: m.label })),
    rules: getRiskRules(userId),
    defaultPre: DEFAULT_PRE_CHECKLIST,
    post: POST_CHECKLIST,
  };
}
export type TradeFormData = ReturnType<typeof tradeFormData>;
