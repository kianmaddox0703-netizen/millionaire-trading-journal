import { Badge, Note, Table, th, td, cx } from "@/components/ui";
import { BASIS_HELP, BASIS_LABEL } from "@/domain/ai/guard";
import {
  ASPECT_LABEL, FIELD_KEYS, FIELD_LABEL, FIT_LABEL, SOURCE_LABEL, STATUS_HELP, STATUS_LABEL, fitCounts,
  type FieldKey, type Fields, type ReadingStatus, type ScreenshotAnalysis,
} from "@/domain/ai/screenshot";
import { fmtNum } from "@/lib/format";
import { BasisBadge } from "./BasisBadge";

/** Presentational pieces for screenshot readings. No hooks or server imports, so both the trade page and the trade form use them. */

const STATUS_TONE: Record<ReadingStatus, "info" | "warn" | "neutral"> = { observed: "info", inferred: "warn", unknown: "neutral" };

export function ReadingBadge({ status }: { status: ReadingStatus }) {
  return <Badge tone={STATUS_TONE[status]} title={STATUS_HELP[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const readingText = (key: FieldKey, value: string | number | null) =>
  value === null ? "—" : key === "direction" ? (value === "long" ? "Long" : "Short") : String(value);

export function FieldTable({ fields }: { fields: Fields }) {
  return (
    <Table>
      <thead><tr><th className={th}>Field</th><th className={th}>Chart reading</th><th className={th}>Status</th></tr></thead>
      <tbody>
        {FIELD_KEYS.map((k) => {
          const r = fields[k];
          return (
            <tr key={k}>
              <td className={cx(td, "align-top text-muted")}>{FIELD_LABEL[k]}</td>
              <td className={cx(td, "min-w-[9rem] whitespace-normal align-top")}>
                <span className="num">{readingText(k, r.value)}</span>
                {r.evidence && <div className="text-[11px] text-faint">{r.evidence}</div>}
              </td>
              <td className={cx(td, "align-top")}><ReadingBadge status={r.status} /></td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function List({ title, hint, items, cls }: { title: string; hint: string; items: string[]; cls: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className={cx("text-[11px] font-medium", cls)}>{title}</div>
      <p className="mb-0.5 text-[11px] text-faint">{hint}</p>
      <ul className="list-disc space-y-0.5 pl-4">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

const RULE_TEXT = (kind: string, status: ScreenshotAnalysis["strategyFit"]["rules"][number]["status"]) =>
  status === "not_visible" ? "Not visible" : kind === "invalidation" ? (status === "met" ? "Not triggered" : "Triggered") : status === "met" ? "Met" : "Not met";
const RULE_TONE = { met: "profit", not_met: "loss", not_visible: "neutral" } as const;
const FIT_TONE = { consistent: "profit", partly: "warn", inconsistent: "loss", cannot_tell: "neutral", no_required: "neutral" } as const;

export interface AnalysisMeta { model: string; at: string; inputTokens: number | null; outputTokens: number | null }

export function ScreenshotAnalysisView({ a, meta, strategyChanged = false }: { a: ScreenshotAnalysis; meta: AnalysisMeta; strategyChanged?: boolean }) {
  const fit = a.strategyFit;
  const c = fitCounts(fit.rules);
  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap items-start gap-2">
        <Badge>{SOURCE_LABEL[a.chartSource]}</Badge>
        {a.summary && <p className="min-w-0 flex-1">{a.summary}</p>}
        {a.summary && <BasisBadge basis="inference" />}
      </div>

      <FieldTable fields={a.fields} />

      <div>
        <span className="text-muted">Risk/reward </span>
        {a.riskReward.value !== null ? <span className="num font-medium">1:{fmtNum(a.riskReward.value)}</span> : <span className="text-muted">unknown</span>}
        <div className="text-[11px] text-faint">{a.riskReward.note}</div>
      </div>

      <List title="Observed" hint="Directly visible in the screenshot." items={a.observed} cls="text-info" />
      <List title="Inferred (likely)" hint="Likely interpretations. Not shown directly." items={a.inferred} cls="text-warn" />
      <List title="Unknown" hint="What this screenshot can't show." items={a.unknown} cls="text-muted" />

      {a.structure.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">Structure</div>
          <ul className="space-y-1">
            {a.structure.map((s, i) => {
              const basis = s.basis === "observed" ? "chart" : "inference";
              return (
                <li key={i}>
                  <span className="text-muted">{ASPECT_LABEL[s.aspect]}: </span>{s.note}{" "}
                  <Badge tone={s.basis === "observed" ? "info" : "warn"} title={BASIS_HELP[basis]}>{BASIS_LABEL[basis]}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] font-medium text-muted">Strategy fit{fit.strategy ? ` · ${fit.strategy}` : ""}</div>
        {strategyChanged && <div className="mb-1"><Note tone="warn">The trade&apos;s strategy changed after this analysis, so these rules may not be the current ones. Re-analyze to check the current strategy.</Note></div>}
        <Badge tone={FIT_TONE[fit.overall]}>{FIT_LABEL[fit.overall]}</Badge>
        {c.required > 0 && <p className="mt-1 text-muted">Required rules: {c.met} met, {c.notMet} not met, {c.notVisible} not visible in the image (of {c.required}).</p>}
        {fit.summary && <p className="mt-1">{fit.summary} <BasisBadge basis="inference" /></p>}
        {fit.rules.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-info">Rule by rule ({fit.rules.length})</summary>
            <ul className="mt-1 space-y-1.5">
              {fit.rules.map((r, i) => (
                <li key={i}>
                  <div className="flex items-start gap-1.5">
                    <Badge tone={RULE_TONE[r.status]}>{RULE_TEXT(r.kind, r.status)}</Badge>
                    <span>{r.rule} <span className="text-[11px] text-faint">({r.kind}{r.required ? ", required" : ", optional"})</span></span>
                  </div>
                  {r.evidence && <div className="pl-1 text-[11px] text-faint">{r.evidence}</div>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div>
        <div className="mb-1 text-[11px] font-medium text-muted">Chart vs your record</div>
        {a.discrepancies.length ? (
          <ul className="space-y-1">
            {a.discrepancies.map((d, i) => (
              <li key={i} className="text-warn">
                {d.topic}: chart {d.chart}, record {d.record}
                <span className="text-[11px] text-faint"> · {d.source === "app" ? "checked by the app" : "noted by the AI"}{d.basis === "inferred" ? ", from an inferred reading" : ""}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">No differences found between the readable chart values and your record.</p>}
      </div>

      <p className="border-t border-line pt-2 text-[11px] text-faint">
        {meta.model} · {meta.at}
        {meta.inputTokens !== null && ` · ${meta.inputTokens.toLocaleString("en-US")} in / ${(meta.outputTokens ?? 0).toLocaleString("en-US")} out tokens`}
        {` · sent at ${a.image.sentWidth}×${a.image.sentHeight}`}{a.image.sentWidth !== a.image.width ? ` (from ${a.image.width}×${a.image.height})` : ""}
        <br />AI reading of the image. Check it against the chart. It describes the setup, not how the trade will turn out.
      </p>
    </div>
  );
}
