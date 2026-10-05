"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { newId } from "@/server/ids";

const txt = z.string().max(5000).default("");
const weekly = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  followedRules: txt, overtraded: txt, forcedSetups: txt, respectedRisk: txt, followedPlan: txt, emotions: txt, lostDiscipline: txt, triggers: txt,
  keepDoing: txt, stopDoing: txt, change: txt, focusNextWeek: txt,
});

export async function saveWeekly(_: unknown, fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  const p = weekly.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Invalid review" };
  const { weekStart, ...answers } = p.data;
  const complete = fd.get("complete") === "1";
  db.insert(schema.weeklyReviews)
    .values({ id: newId(), userId: user.id, weekStart, ...answers, completedAt: complete ? new Date() : null })
    .onConflictDoUpdate({ target: [schema.weeklyReviews.userId, schema.weeklyReviews.weekStart], set: { ...answers, updatedAt: new Date(), ...(complete ? { completedAt: new Date() } : {}) } })
    .run();
  revalidatePath("/reviews");
  return { ok: true };
}

const monthly = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), notes: txt, biggestImprovement: txt, focusNextMonth: txt });
export async function saveMonthly(_: unknown, fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  const p = monthly.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Invalid review" };
  const { month, ...rest } = p.data;
  db.insert(schema.monthlyReviews).values({ id: newId(), userId: user.id, month, ...rest })
    .onConflictDoUpdate({ target: [schema.monthlyReviews.userId, schema.monthlyReviews.month], set: { ...rest, updatedAt: new Date() } }).run();
  revalidatePath("/reviews");
  return { ok: true };
}
