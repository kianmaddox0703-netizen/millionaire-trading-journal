"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { config } from "@/server/config";
import { createWebhookToken, revokeWebhookToken, linkAlert, unlinkAlert } from "@/server/tradingview";
import { createBridgeKey, revokeBridgeKey } from "@/server/mt5";

/** Secrets are returned once to the browser that created them and never stored in plain text. */
export async function createWebhookAction(): Promise<{ url: string }> {
  const user = await requireUser();
  const token = createWebhookToken(user.id);
  revalidatePath("/settings/integrations");
  return { url: `${config.appUrl().replace(/\/$/, "")}/api/webhooks/tradingview/${token}` };
}

export async function revokeWebhookAction() {
  const user = await requireUser();
  revokeWebhookToken(user.id);
  revalidatePath("/settings/integrations");
}

export async function createBridgeKeyAction(accountId: string, label: string): Promise<{ key?: string; error?: string }> {
  const user = await requireUser();
  try {
    const key = createBridgeKey(user.id, accountId, label);
    revalidatePath("/settings/integrations");
    return { key };
  } catch {
    return { error: "Account not found" };
  }
}

export async function revokeBridgeKeyAction(id: string) {
  const user = await requireUser();
  revokeBridgeKey(user.id, id);
  revalidatePath("/settings/integrations");
}

export async function linkAlertAction(tradeId: string, alertId: string) {
  const user = await requireUser();
  linkAlert(user.id, tradeId, alertId);
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/settings/integrations");
}

export async function unlinkAlertAction(tradeId: string, alertId: string) {
  const user = await requireUser();
  unlinkAlert(user.id, tradeId, alertId);
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/settings/integrations");
}
