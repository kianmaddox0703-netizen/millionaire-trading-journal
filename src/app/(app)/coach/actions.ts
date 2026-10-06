"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { deleteConversation } from "@/server/ai/coach";

export async function deleteConversationAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const u = await requireUser();
  if (typeof id !== "string" || !/^[0-9A-Za-z]{1,64}$/.test(id)) return { ok: false, error: "Invalid conversation." };
  const ok = deleteConversation(u.id, id);
  revalidatePath("/coach");
  return ok ? { ok: true } : { ok: false, error: "Conversation not found." };
}
