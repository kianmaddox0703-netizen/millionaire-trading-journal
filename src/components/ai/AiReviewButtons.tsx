"use client";
import { useState, useTransition } from "react";
import { Button, cx } from "@/components/ui";
import { addSuggestedMistakeAction, generateTradeReviewAction, type AiActionResult } from "@/app/(app)/reviews/ai-actions";

export function useAiAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AiActionResult | null>(null);
  const run = (fn: () => Promise<AiActionResult>) => start(async () => {
    setResult(null);
    try { setResult(await fn()); } catch { setResult({ ok: false, message: "The request failed. Reload the page and try again." }); }
  });
  return { pending, result, run };
}

export function ActionStatus({ pending, result, busy }: { pending: boolean; result: AiActionResult | null; busy: string }) {
  return (
    <span role="status" aria-live="polite" className={cx("text-[11px]", pending || !result ? "text-muted" : result.ok ? "text-profit" : "text-loss")}>
      {pending ? busy : result?.message ?? ""}
    </span>
  );
}

/** "Generate review" / "Regenerate" for one trade. The page re-renders with the stored result. */
export function AiReviewButton({ tradeId, hasReview }: { tradeId: string; hasReview: boolean }) {
  const { pending, result, run } = useAiAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => generateTradeReviewAction(tradeId))} data-ai-review-generate>
        {pending ? "Writing review…" : hasReview ? "Regenerate" : "Generate review"}
      </Button>
      <ActionStatus pending={pending} result={result} busy="Writing the review from this trade's data. This can take up to a minute." />
    </div>
  );
}

/** "Add to trade" for one mistake the review suggested. */
export function AiReviewMistakeButton({ tradeId, mistakeKey, label }: { tradeId: string; mistakeKey: string; label: string }) {
  const { pending, result, run } = useAiAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => addSuggestedMistakeAction(tradeId, mistakeKey))} data-ai-add-mistake={mistakeKey}>
        {pending ? "Adding…" : "Add to trade"}<span className="sr-only">: {label}</span>
      </Button>
      <ActionStatus pending={pending} result={result} busy="Adding…" />
    </div>
  );
}
