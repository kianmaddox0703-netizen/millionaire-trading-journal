"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { selectedAccount } from "@/server/prefs";
import { NotFoundError } from "@/server/trades";
import { AiNotConfiguredError, AiRateLimitError, describeAiError, logAiFailure } from "@/server/ai/client";
import { ReviewInputError, addSuggestedMistake, generateTradeReview, reviewBeingWritten } from "@/server/ai/review";
import { PeriodInputError, generatePeriodSummary } from "@/server/ai/periodSummary";
import { validPeriod, type PeriodKind } from "@/domain/ai/period";

export type AiActionResult = { ok: boolean; message: string };

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9A-Za-z_-]{1,64}$/.test(v);

function failure(where: string, e: unknown): AiActionResult {
  if (e instanceof NotFoundError) return { ok: false, message: "Not found." };
  if (e instanceof ReviewInputError || e instanceof PeriodInputError || e instanceof AiNotConfiguredError || e instanceof AiRateLimitError) return { ok: false, message: e.message };
  logAiFailure(where, e);
  return { ok: false, message: describeAiError(e) };
}

/** "Generate review" / "Regenerate" on a trade page. Ownership is enforced by the user-scoped lookups. */
export async function generateTradeReviewAction(tradeId: string): Promise<AiActionResult> {
  const user = await requireUser();
  if (!isId(tradeId)) return { ok: false, message: "Not found." };
  if (reviewBeingWritten(tradeId)) return { ok: false, message: "The automatic review of this trade is still being written. Reload the page in a minute." };
  try {
    const r = await generateTradeReview(user.id, tradeId);
    revalidatePath(`/trades/${tradeId}`);
    return r.ok ? { ok: true, message: "Review written." } : { ok: false, message: `The review failed: ${r.error}` };
  } catch (e) {
    return failure("trade review", e);
  }
}

/** "Add to trade" on a suggested mistake. The key must be a known mistake in the latest review of the user's own trade. */
export async function addSuggestedMistakeAction(tradeId: string, key: string): Promise<AiActionResult> {
  const user = await requireUser();
  if (!isId(tradeId) || typeof key !== "string" || key.length > 40) return { ok: false, message: "Not found." };
  try {
    const r = addSuggestedMistake(user.id, tradeId, key);
    if (r.ok) revalidatePath(`/trades/${tradeId}`);
    return r;
  } catch (e) {
    return failure("add suggested mistake", e);
  }
}

/**
 * "Generate AI summary" / "Regenerate" on a week or month review page. `scope` is the account scope the page
 * was rendered with ("all" or an account id); if the selection changed since, the user reloads instead of
 * getting a summary for a different scope than the one on screen.
 */
export async function generatePeriodSummaryAction(kind: PeriodKind, period: string, scope: string): Promise<AiActionResult> {
  const user = await requireUser();
  if ((kind !== "weekly" && kind !== "monthly") || typeof period !== "string" || !validPeriod(kind, period)) return { ok: false, message: "Invalid period." };
  const accountId = await selectedAccount(user.id);
  if ((accountId ?? "all") !== scope) return { ok: false, message: "The selected account changed. Reload the page and try again." };
  try {
    const r = await generatePeriodSummary(user.id, kind, period, accountId);
    revalidatePath(kind === "weekly" ? `/reviews/week/${period}` : `/reviews/month/${period}`);
    return r.ok ? { ok: true, message: "Summary written." } : { ok: false, message: `The summary failed: ${r.error}` };
  } catch (e) {
    return failure(`${kind} summary`, e);
  }
}
