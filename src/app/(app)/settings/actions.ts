"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser, verifyPassword, hashPassword } from "@/server/auth";
import { db, schema } from "@/server/db";
import { newId } from "@/server/ids";
import { riskRulesInput } from "@/domain/validation";
import { refreshRuleMistakes } from "@/server/trades";
import { setupScore } from "@/domain/score";

type R = { ok?: boolean; error?: string };

export async function saveProfile(_: R, fd: FormData): Promise<R> {
  const user = await requireUser();
  const p = z.object({ name: z.string().trim().max(80), timezone: z.string().max(60), baseCurrency: z.string().regex(/^[A-Z]{3}$/) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Invalid profile" };
  try { new Intl.DateTimeFormat("en", { timeZone: p.data.timezone }); } catch { return { error: "Unknown timezone" }; }
  db.update(schema.users).set({ ...p.data, updatedAt: new Date() }).where(eq(schema.users.id, user.id)).run();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveAiPrefs(_: R, fd: FormData): Promise<R> {
  const user = await requireUser();
  db.update(schema.users).set({ aiAutoReview: fd.get("aiAutoReview") === "on", updatedAt: new Date() }).where(eq(schema.users.id, user.id)).run();
  revalidatePath("/settings");
  return { ok: true };
}

export async function changePassword(_: R, fd: FormData): Promise<R> {
  const user = await requireUser();
  const cur = String(fd.get("current") ?? ""), next = String(fd.get("next") ?? "");
  if (next.length < 10) return { error: "New password needs at least 10 characters." };
  const row = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()!;
  if (!(await verifyPassword(cur, row.passwordHash))) return { error: "Current password is incorrect." };
  db.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, user.id)).run();
  return { ok: true };
}

const acct = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["live", "prop", "demo", "backtest"]),
  broker: z.string().max(60).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  startingBalance: z.preprocess(Number, z.number().finite().min(0)),
  isArchived: z.boolean(),
});

export async function saveAccount(_: R, fd: FormData): Promise<R> {
  const user = await requireUser();
  const p = acct.safeParse({ ...Object.fromEntries(fd), isArchived: fd.get("isArchived") === "on" });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid account" };
  const { id, ...v } = p.data;
  if (id) {
    const res = db.update(schema.accounts).set({ ...v, updatedAt: new Date() }).where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, user.id))).run();
    if (!res.changes) return { error: "Account not found" };
  } else db.insert(schema.accounts).values({ id: newId(), userId: user.id, ...v }).run();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveRiskRules(_: R, fd: FormData): Promise<R> {
  const user = await requireUser();
  const p = riskRulesInput.safeParse({ ...Object.fromEntries(fd), restrictedDays: fd.getAll("restrictedDays"), requireChecklist: fd.get("requireChecklist") });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid rules" };
  const existing = db.select().from(schema.riskRules).where(eq(schema.riskRules.userId, user.id)).get();
  if (existing) db.update(schema.riskRules).set({ ...p.data, updatedAt: new Date() }).where(eq(schema.riskRules.id, existing.id)).run();
  else db.insert(schema.riskRules).values({ id: newId(), userId: user.id, ...p.data }).run();
  // Re-evaluate rule-based mistakes on all trades against the new rules.
  for (const t of db.select({ id: schema.trades.id }).from(schema.trades).where(eq(schema.trades.userId, user.id)).all()) refreshRuleMistakes(user.id, t.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveFactors(_: R, fd: FormData): Promise<R> {
  const user = await requireUser();
  const factors = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, user.id)).all();
  for (const f of factors) {
    const w = Number(fd.get(`w_${f.key}`));
    const label = String(fd.get(`l_${f.key}`) ?? f.label).trim().slice(0, 60) || f.label;
    if (!Number.isFinite(w) || w < 0 || w > 100) return { error: `Weight for ${f.label} must be 0–100` };
    db.update(schema.scoreFactors).set({ weight: w, label }).where(eq(schema.scoreFactors.id, f.id)).run();
  }
  const nk = String(fd.get("newLabel") ?? "").trim();
  if (nk) {
    const key = nk.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
    if (!factors.some((f) => f.key === key)) db.insert(schema.scoreFactors).values({ id: newId(), userId: user.id, key, label: nk.slice(0, 60), weight: Number(fd.get("newWeight")) || 10, sort: factors.length }).run();
  }
  // Stored setup scores depend on the weights, so recompute them.
  const fresh = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, user.id)).all();
  const byTrade = new Map<string, Record<string, number>>();
  for (const r of db.select().from(schema.tradeFactorRatings).where(eq(schema.tradeFactorRatings.userId, user.id)).all())
    byTrade.set(r.tradeId, { ...(byTrade.get(r.tradeId) ?? {}), [r.factorKey]: r.rating });
  db.transaction((tx) => {
    for (const [tradeId, ratings] of byTrade) tx.update(schema.trades).set({ setupScore: setupScore(fresh, ratings) }).where(eq(schema.trades.id, tradeId)).run();
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
