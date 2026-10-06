import { CONTEXT_DEFINITIONS, CONTEXT_DISCLAIMER, CONTEXT_VERSION } from "@/domain/marketContext";

/** "How this is computed" disclosure for the automatic market context. */
export function ContextDefinitions() {
  return (
    <details className="group text-[12px]">
      <summary className="cursor-pointer select-none text-muted hover:text-fg">How this is computed</summary>
      <div className="mt-2 space-y-2 rounded border border-line bg-surface-2 p-2.5">
        <p className="text-warn">{CONTEXT_DISCLAIMER}</p>
        <dl className="space-y-1.5">
          {CONTEXT_DEFINITIONS.map(([k, v]) => (
            <div key={k}><dt className="font-medium">{k}</dt><dd className="text-muted">{v}</dd></div>
          ))}
        </dl>
        <p className="text-[11px] text-faint">Definitions version {CONTEXT_VERSION}. Candles are real provider data fetched for each trade; nothing is estimated or simulated.</p>
      </div>
    </details>
  );
}
