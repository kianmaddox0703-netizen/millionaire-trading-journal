import { Note } from "@/components/ui";
import type { StoredPeriodSummary } from "@/domain/ai/period";
import { BasisBadge, BasisLegend, BasisPoints } from "./BasisBadge";

/** A stored AI weekly or monthly summary (presentational). */
export function AiPeriodView({ s, meta }: { s: StoredPeriodSummary; meta: { model: string; at: string; inputTokens: number | null; outputTokens: number | null } }) {
  const unit = s.kind === "weekly" ? "week" : "month";
  return (
    <div className="space-y-3">
      {s.caveats.length > 0 && <Note tone="warn"><ul className="list-disc space-y-0.5 pl-4">{s.caveats.map((c) => <li key={c}>{c}</li>)}</ul></Note>}
      {s.summary && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-muted">AI summary</span><BasisBadge basis="inference" /></div>
          <p className="text-[13px]">{s.summary}</p>
        </div>
      )}
      {s.aiCaveats.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-muted">The AI also noted</span><BasisBadge basis="inference" /></div>
          <ul className="list-disc space-y-0.5 pl-4 text-[12px]">{s.aiCaveats.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <BasisPoints title="Performance" points={s.performance} />
      <BasisPoints title="Process" points={s.process} />
      <BasisPoints title="Psychology" points={s.psychology} />
      <BasisPoints title="Keep doing" titleClass="mb-1 text-[11px] font-medium text-profit" points={s.keep} />
      <BasisPoints title="Stop doing" titleClass="mb-1 text-[11px] font-medium text-loss" points={s.stop} />
      <BasisPoints title="Change" titleClass="mb-1 text-[11px] font-medium text-warn" points={s.change} />
      {s.kind === "monthly" && <BasisPoints title="Compared with previous months" titleClass="mb-1 text-[11px] font-medium text-info" points={s.comparison} />}
      {s.focus.text && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-info">Suggested focus for next {unit}</span><BasisBadge basis="opinion" /></div>
          <p className="text-[12px]">{s.focus.text}</p>
        </div>
      )}
      {s.redactions > 0 && <p className="text-[11px] text-warn">{s.redactions} sentence{s.redactions === 1 ? " was" : "s were"} removed because {s.redactions === 1 ? "it" : "they"} stated certainty about an outcome.</p>}
      <BasisLegend />
      <div className="text-[11px] text-faint">
        Based on {s.basedOn.trades} closed trade{s.basedOn.trades === 1 ? "" : "s"} · {meta.model} · {meta.at}{meta.inputTokens !== null ? ` · ${meta.inputTokens} in / ${meta.outputTokens ?? "?"} out tokens` : ""}
      </div>
    </div>
  );
}
