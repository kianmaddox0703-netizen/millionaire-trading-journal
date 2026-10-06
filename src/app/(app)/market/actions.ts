"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { fetchMissingContext, refreshTradeContext } from "@/server/marketdata/context";

export type ContextActionResult = { ok: boolean; message: string };

/** Re-fetch one trade's market context. Ownership is enforced by the user-scoped lookup. */
export async function refreshTradeContextAction(tradeId: string): Promise<ContextActionResult> {
  const user = await requireUser();
  if (typeof tradeId !== "string" || !tradeId || tradeId.length > 64) return { ok: false, message: "Trade not found." };
  const r = await refreshTradeContext(user.id, tradeId);
  if (r.status !== null) revalidatePath(`/trades/${tradeId}`);
  return { ok: r.status === "ok", message: r.message };
}

/** One batch of context fetches for the user's trades that don't have it yet. */
export async function fetchMissingContextAction(): Promise<ContextActionResult> {
  const user = await requireUser();
  const r = await fetchMissingContext(user.id);
  revalidatePath("/market");
  const done = r.ok + r.error + r.pending + r.unsupported;
  const parts = [
    done ? `Processed ${done} trade${done === 1 ? "" : "s"}: ${r.ok} with context${r.error ? `, ${r.error} failed` : ""}${r.unsupported ? `, ${r.unsupported} unsupported symbol${r.unsupported === 1 ? "" : "s"}` : ""}${r.pending ? `, ${r.pending} waiting on the rate limit` : ""}.` : "Nothing was fetched.",
    r.stopped ? `Stopped early: ${r.stopped}` : "",
    r.remaining ? `${r.remaining} trade${r.remaining === 1 ? "" : "s"} still without context${r.stopped ? "" : "; click again to continue"}.` : "Every trade has context or an unsupported symbol.",
  ];
  return { ok: !r.stopped && r.error === 0, message: parts.filter(Boolean).join(" ") };
}
