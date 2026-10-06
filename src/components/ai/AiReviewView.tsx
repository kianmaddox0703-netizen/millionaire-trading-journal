import type { ReactNode } from "react";
import { Badge, StrengthBadge, cx } from "@/components/ui";
import { PLAN_STATUS_LABEL, type PlanStatus, type StoredTradeReview } from "@/domain/ai/review";
import { BasisBadge, BasisLegend, BasisPoints } from "./BasisBadge";

const STATUS_TONE: Record<PlanStatus, "profit" | "loss" | "neutral"> = { followed: "profit", broken: "loss", not_recorded: "neutral" };
const GROUP_LABEL: Record<string, string> = { rule: "Rule", confirmation: "Confirmation", invalidation: "Invalidation", checklist: "Checklist", risk: "Risk rule" };

/**
 * The stored AI review (presentational). `addAction` renders the "Add to trade" control for a suggested
 * mistake; suggestions whose key is already on the trade are hidden.
 */
export function AiReviewView({ r, existingKeys, addAction, meta }: {
  r: StoredTradeReview;
  existingKeys: string[];
  addAction?: (key: string, label: string) => ReactNode;
  meta: { model: string; at: string; inputTokens: number | null; outputTokens: number | null };
}) {
  const suggestions = r.suggestedMistakes.filter((s) => !existingKeys.includes(s.key));
  const counts = { followed: 0, broken: 0, not_recorded: 0 } as Record<PlanStatus, number>;
  for (const p of r.planCheck) counts[p.status]++;
  const h = r.historicalComparison;
  return (
    <div className="space-y-3">
      {r.headline && <p className="text-[13px] font-medium">{r.headline}</p>}
      <BasisPoints title="What went well" titleClass="mb-1 text-[11px] font-medium text-profit" points={r.wentWell} />
      <BasisPoints title="Issues" titleClass="mb-1 text-[11px] font-medium text-warn" points={r.issues} />

      {r.planCheck.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-medium text-info">
            Plan check: {counts.followed} followed · {counts.broken} broken · {counts.not_recorded} not recorded
          </summary>
          <ul className="mt-1.5 space-y-1.5 text-[12px]">
            {r.planCheck.map((p) => (
              <li key={p.id} className="border-b border-line/60 pb-1.5 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><span className="text-faint">{GROUP_LABEL[p.group] ?? p.group}{p.required ? "" : " (optional)"}:</span> {p.rule}</span>
                  <Badge tone={STATUS_TONE[p.status]} className="shrink-0">{PLAN_STATUS_LABEL[p.status]}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-muted">{p.evidence}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-info">Historical comparison</span>
          <span className="flex items-center gap-1">{h.strength ? <StrengthBadge s={h.strength} n={h.n} /> : <Badge>n={h.n}</Badge>}<BasisBadge basis="history" /></span>
        </div>
        <p className="text-[12px]">{h.text}</p>
        {h.source === "app" && h.n > 0 && <p className="mt-0.5 text-[11px] text-faint">Worded by the app from your statistics: the AI&apos;s version used numbers that aren&apos;t in your history, so it wasn&apos;t shown.</p>}
      </div>

      {suggestions.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium text-warn">Possible mistakes to tag</div>
          <ul className="space-y-2 text-[12px]">
            {suggestions.map((s) => (
              <li key={s.key} className="rounded border border-line bg-surface-2 p-2">
                <div className="flex items-start justify-between gap-2"><Badge tone="warn">{s.label}</Badge><BasisBadge basis="inference" /></div>
                <blockquote className="mt-1 border-l-2 border-line-strong pl-2 text-muted"><span className="sr-only">Your words: </span>&ldquo;{s.quote}&rdquo;</blockquote>
                <p className="mt-1">{s.evidence}</p>
                {addAction && <div className="mt-1.5">{addAction(s.key, s.label)}</div>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-faint">Suggestions only. Nothing is added unless you choose it.</p>
        </div>
      )}
      {r.droppedSuggestions > 0 && <p className="text-[11px] text-faint">{r.droppedSuggestions} suggestion{r.droppedSuggestions === 1 ? " was" : "s were"} left out because the quoted words couldn&apos;t be found in your records.</p>}

      {r.lesson.text && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-muted">Lesson</span><BasisBadge basis="opinion" /></div>
          <p className="text-[12px]">{r.lesson.text}</p>
        </div>
      )}

      {r.redactions > 0 && <p className="text-[11px] text-warn">{r.redactions} sentence{r.redactions === 1 ? " was" : "s were"} removed because {r.redactions === 1 ? "it" : "they"} stated certainty about an outcome.</p>}
      <BasisLegend />
      <div className={cx("text-[11px] text-faint")}>
        {meta.model} · {meta.at}{meta.inputTokens !== null ? ` · ${meta.inputTokens} in / ${meta.outputTokens ?? "?"} out tokens` : ""}
      </div>
    </div>
  );
}
