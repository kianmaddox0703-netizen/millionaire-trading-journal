"use client";
import { useRef, useState } from "react";
import { Badge, Button, Note, Table, th, td, cx } from "@/components/ui";
import { SOURCE_LABEL, ScreenshotExtract, fillPlan, patchFor, type FieldKey, type FormPatch, type FormSnapshot } from "@/domain/ai/screenshot";
import { ReadingBadge, readingText } from "./ScreenshotAnalysisView";

/** Quick entry on the trade form: read a staged (not yet uploaded) screenshot and offer its readings as form values. */

export type ReadState =
  | { imageId: string; name: string; status: "loading" }
  | { imageId: string; name: string; status: "done"; result: ScreenshotExtract; model: string }
  | { imageId: string; name: string; status: "error"; error: string; notConfigured: boolean };

export function useScreenshotReader() {
  const [state, setState] = useState<ReadState | null>(null);
  const seq = useRef(0);
  const read = async (img: { id: string; file: File }) => {
    const n = ++seq.current;
    const base = { imageId: img.id, name: img.file.name };
    const done = (s: ReadState) => { if (n === seq.current) setState(s); }; // a newer read wins
    setState({ ...base, status: "loading" });
    try {
      const fd = new FormData();
      fd.append("file", img.file);
      const res = await fetch("/api/ai/screenshot/extract", { method: "POST", body: fd });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; model?: string; error?: string; code?: string } | null;
      if (!res.ok || !j?.ok) return done({ ...base, status: "error", error: j?.error ?? `Reading failed (${res.status}).`, notConfigured: j?.code === "not_configured" });
      const parsed = ScreenshotExtract.safeParse(j.result);
      if (!parsed.success) return done({ ...base, status: "error", error: "The server's answer couldn't be read.", notConfigured: false });
      done({ ...base, status: "done", result: parsed.data, model: j.model ?? "" });
    } catch {
      done({ ...base, status: "error", error: "Couldn't reach the server.", notConfigured: false });
    }
  };
  const clear = () => { seq.current++; setState(null); };
  return { state, read, clear, busyId: state?.status === "loading" ? state.imageId : null };
}

export function ScreenshotReadings({ state, form, directionChosen, onApply, onClose }: {
  state: ReadState; form: FormSnapshot; directionChosen: boolean; onApply: (patch: FormPatch) => void; onClose: () => void;
}) {
  if (state.status === "loading") {
    return <div role="status" aria-live="polite" className="mt-2 rounded border border-line bg-surface-2 px-3 py-2 text-[12px] text-muted">Reading {state.name}… This can take up to a minute.</div>;
  }
  if (state.status === "error") {
    return (
      <div role="status" aria-live="polite" className="mt-2 flex items-start gap-2">
        <div className="flex-1"><Note tone={state.notConfigured ? "neutral" : "loss"}>{state.error}</Note></div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Dismiss</Button>
      </div>
    );
  }
  const rows = fillPlan(state.result.fields, form, directionChosen);
  const auto = rows.filter((r) => r.autoFill);
  const counts = (["observed", "inferred", "unknown"] as const).map((s) => `${rows.filter((r) => r.status === s).length} ${s}`).join(", ");
  const use = (keys: FieldKey[]) => onApply(patchFor(rows, keys));
  return (
    <section className="mt-2 rounded border border-line bg-surface-2 p-2" aria-label={`Readings from ${state.name}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">Readings from {state.name}</span>
        <Badge>{SOURCE_LABEL[state.result.chartSource]}</Badge>
        <span role="status" aria-live="polite" className="text-[11px] text-faint">Readings ready: {counts}.</span>
        <span className="ml-auto flex gap-1.5">
          <Button type="button" size="sm" variant="primary" disabled={!auto.length} onClick={() => use(auto.map((r) => r.key))}>
            Fill empty fields{auto.length ? ` (${auto.length})` : ""}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Dismiss</Button>
        </span>
      </div>
      <Table>
        <thead><tr><th className={th}>Field</th><th className={th}>Chart reading</th><th className={th}>Status</th><th className={th}><span className="sr-only">Action</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={cx(td, "align-top text-muted")}>{r.label}</td>
              <td className={cx(td, "min-w-[9rem] whitespace-normal align-top")}>
                <span className="num">{readingText(r.key, r.reading)}</span>
                {r.evidence && <div className="text-[11px] text-faint">{r.evidence}</div>}
              </td>
              <td className={cx(td, "align-top")}><ReadingBadge status={r.status} /></td>
              <td className={cx(td, "whitespace-normal align-top text-[11px] text-faint")}>
                {r.canUse
                  ? <Button type="button" size="sm" onClick={() => use([r.key])}>Use<span className="sr-only"> {r.label.toLowerCase()} reading</span></Button>
                  : r.note ?? (r.formValue !== null && r.formValue === r.current ? "Same as form" : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {state.result.unknown.length > 0 && (
        <div className="mt-2 text-[12px]">
          <div className="text-[11px] font-medium text-muted">The screenshot can&apos;t show</div>
          <ul className="list-disc pl-4">{state.result.unknown.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      <p className="mt-2 text-[11px] text-faint">
        Fill empty fields uses observed readings only, and only for fields that are still empty. Inferred readings need a click on Use. Nothing you typed is changed.
        AI reading of the image{state.model ? ` (${state.model})` : ""}; check it against the chart. To read it, the image is sent to the Anthropic API; the app itself keeps nothing until you save the trade, and the screenshot is then saved with it as usual.
      </p>
    </section>
  );
}
