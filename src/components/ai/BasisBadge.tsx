import { Badge } from "@/components/ui";
import { BASIS_HELP, BASIS_LABEL, type Basis } from "@/domain/ai/guard";

const TONE: Record<Basis, "neutral" | "info" | "warn"> = { data: "neutral", history: "info", chart: "info", inference: "warn", opinion: "warn" };

/** Where an AI statement comes from: your records, historical evidence, the chart, inference or opinion. */
export function BasisBadge({ basis }: { basis: Basis }) {
  return <Badge tone={TONE[basis]} title={BASIS_HELP[basis]} className="shrink-0">{BASIS_LABEL[basis]}</Badge>;
}

/** A titled list of AI points, each with its basis badge. Renders nothing for an empty list. */
export function BasisPoints({ title, points, titleClass }: { title: string; points: { text: string; basis: Basis }[]; titleClass?: string }) {
  if (!points.length) return null;
  return (
    <div>
      <div className={titleClass ?? "mb-1 text-[11px] font-medium text-muted"}>{title}</div>
      <ul className="space-y-1.5 text-[12px]">
        {points.map((p, i) => (
          <li key={i} className="flex items-start justify-between gap-2"><span className="min-w-0">{p.text}</span><BasisBadge basis={p.basis} /></li>
        ))}
      </ul>
    </div>
  );
}

/** The legend for the badges, so their meaning is readable without hovering. */
export function BasisLegend() {
  return (
    <details className="text-[11px] text-faint">
      <summary className="cursor-pointer text-info">What the labels mean</summary>
      <dl className="mt-1 space-y-0.5">
        {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => <div key={b}><dt className="inline font-medium text-muted">{BASIS_LABEL[b]}:</dt> <dd className="inline">{BASIS_HELP[b]}</dd></div>)}
      </dl>
    </details>
  );
}
