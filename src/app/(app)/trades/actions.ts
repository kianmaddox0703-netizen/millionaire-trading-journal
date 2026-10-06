"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { tradeInput } from "@/domain/validation";
import { deleteTrade, NotFoundError, saveTrade } from "@/server/trades";
import { db, schema } from "@/server/db";
import { and, eq } from "drizzle-orm";
import { deleteStored } from "@/server/storage";
import { afterTradesSaved } from "@/server/hooks";

export type SaveResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function saveTradeAction(raw: unknown, tradeId?: string): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = tradeInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  try {
    const id = saveTrade(user.id, parsed.data, tradeId);
    afterTradesSaved(user.id, [id], "manual");
    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (e) {
    if (e instanceof NotFoundError) return { ok: false, error: e.message };
    console.error("saveTrade failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "Could not save the trade." };
  }
}

export async function deleteTradeAction(tradeId: string): Promise<SaveResult> {
  const user = await requireUser();
  const imgs = db.select().from(schema.tradeImages).where(and(eq(schema.tradeImages.tradeId, tradeId), eq(schema.tradeImages.userId, user.id))).all();
  try {
    deleteTrade(user.id, tradeId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
  await deleteStored(...imgs.flatMap((i) => [i.storageKey, i.thumbKey]));
  revalidatePath("/", "layout");
  return { ok: true, id: tradeId };
}

export async function deleteImageAction(imageId: string) {
  const user = await requireUser();
  const img = db.select().from(schema.tradeImages).where(and(eq(schema.tradeImages.id, imageId), eq(schema.tradeImages.userId, user.id))).get();
  if (!img) return { ok: false };
  db.delete(schema.tradeImages).where(eq(schema.tradeImages.id, img.id)).run();
  await deleteStored(img.storageKey, img.thumbKey);
  revalidatePath(`/trades/${img.tradeId}`);
  return { ok: true };
}

export async function updateImageAction(imageId: string, kind: string, caption: string) {
  const user = await requireUser();
  const kinds = ["before", "entry", "during", "exit", "tradingview", "mt5", "other"] as const;
  const k = (kinds as readonly string[]).includes(kind) ? (kind as (typeof kinds)[number]) : "other";
  const res = db.update(schema.tradeImages).set({ kind: k, caption: caption.slice(0, 300) }).where(and(eq(schema.tradeImages.id, imageId), eq(schema.tradeImages.userId, user.id))).run();
  return { ok: res.changes > 0 };
}
