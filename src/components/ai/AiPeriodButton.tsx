"use client";
import { Button } from "@/components/ui";
import { generatePeriodSummaryAction } from "@/app/(app)/reviews/ai-actions";
import type { PeriodKind } from "@/domain/ai/period";
import { ActionStatus, useAiAction } from "./AiReviewButtons";

/** "Generate AI summary" / "Regenerate" for a week or month in the account scope the page shows. */
export function AiPeriodButton({ kind, period, scope, hasSummary }: { kind: PeriodKind; period: string; scope: string; hasSummary: boolean }) {
  const { pending, result, run } = useAiAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={pending} onClick={() => run(() => generatePeriodSummaryAction(kind, period, scope))} data-ai-period-generate={kind}>
        {pending ? "Writing summary…" : hasSummary ? "Regenerate" : "Generate AI summary"}
      </Button>
      <ActionStatus pending={pending} result={result} busy={`Summarizing the ${kind === "weekly" ? "week" : "month"} from your trades and your review. This can take up to a minute.`} />
    </div>
  );
}
