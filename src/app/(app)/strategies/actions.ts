"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { newId } from "@/server/ids";
import { createFxAlexgStrategy } from "@/server/trades";

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50);
const input = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(4000).default(""),
  preferredSessions: z.string().max(200).default(""),
  preferredPairs: z.string().max(200).default(""),
  preferredConditions: z.string().max(500).default(""),
  isActive: z.boolean(),
  rule: z.string().max(10000).default(""),
  confirmation: z.string().max(10000).default(""),
  invalidation: z.string().max(10000).default(""),
  checklist: z.string().max(10000).default(""),
  setups: z.string().max(4000).default(""),
});

export async function saveStrategy(_: unknown, fd: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const id = String(fd.get("id") ?? "");
  const p = input.safeParse({ ...Object.fromEntries(fd), isActive: fd.get("isActive") === "on" });
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Invalid input" };
  const d = p.data;
  if (id && !db.select().from(schema.strategies).where(and(eq(schema.strategies.id, id), eq(schema.strategies.userId, user.id))).get()) return { error: "Not found" };
  const sid = id || newId();
  db.transaction((tx) => {
    const vals = { name: d.name, description: d.description, preferredSessions: d.preferredSessions, preferredPairs: d.preferredPairs, preferredConditions: d.preferredConditions, isActive: d.isActive, updatedAt: new Date() };
    if (id) tx.update(schema.strategies).set(vals).where(eq(schema.strategies.id, sid)).run();
    else tx.insert(schema.strategies).values({ id: sid, userId: user.id, ...vals }).run();
    const old = tx.select().from(schema.strategyRules).where(eq(schema.strategyRules.strategyId, sid)).all();
    tx.delete(schema.strategyRules).where(eq(schema.strategyRules.strategyId, sid)).run();
    let sort = 0;
    for (const kind of ["rule", "confirmation", "invalidation", "checklist"] as const) {
      for (const raw of lines(d[kind])) {
        const optional = /\(optional\)\s*$/i.test(raw);
        const text = raw.replace(/\s*\(optional\)\s*$/i, "");
        const slug = old.find((o) => o.kind === kind && o.text === text)?.kbConceptSlug ?? null;
        tx.insert(schema.strategyRules).values({ id: newId(), strategyId: sid, kind, text, isRequired: !optional, sort: sort++, kbConceptSlug: slug }).run();
      }
    }
    const wanted = lines(d.setups);
    const existing = tx.select().from(schema.setups).where(eq(schema.setups.strategyId, sid)).all();
    const remove = existing.filter((e) => !wanted.includes(e.name)).map((e) => e.id);
    if (remove.length) tx.delete(schema.setups).where(inArray(schema.setups.id, remove)).run();
    for (const name of wanted) if (!existing.some((e) => e.name === name)) tx.insert(schema.setups).values({ id: newId(), userId: user.id, strategyId: sid, name }).run();
  });
  revalidatePath("/strategies");
  redirect(`/strategies/${sid}`);
}

export async function deleteStrategy(id: string) {
  const user = await requireUser();
  db.delete(schema.strategies).where(and(eq(schema.strategies.id, id), eq(schema.strategies.userId, user.id))).run();
  revalidatePath("/", "layout");
  redirect("/strategies");
}

export async function addFxAlexgTemplate() {
  const user = await requireUser();
  const id = createFxAlexgStrategy(user.id);
  redirect(`/strategies/${id}`);
}
