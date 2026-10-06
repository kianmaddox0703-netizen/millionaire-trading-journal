"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { fetchMissingContextAction, refreshTradeContextAction, type ContextActionResult } from "@/app/(app)/market/actions";

function useContextAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ContextActionResult | null>(null);
  const runAction = (fn: () => Promise<ContextActionResult>) => start(async () => {
    setResult(null);
    try { setResult(await fn()); } catch { setResult({ ok: false, message: "The request failed. Reload the page and try again." }); }
  });
  return { pending, result, runAction };
}

function Status({ pending, result, busy }: { pending: boolean; result: ContextActionResult | null; busy: string }) {
  return (
    <span aria-live="polite" role="status" className={result && !pending ? (result.ok ? "text-[12px] text-profit" : "text-[12px] text-warn") : "text-[12px] text-muted"}>
      {pending ? busy : result?.message ?? ""}
    </span>
  );
}

export function RefreshContextButton({ tradeId, label = "Refresh" }: { tradeId: string; label?: string }) {
  const { pending, result, runAction } = useContextAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending} onClick={() => runAction(() => refreshTradeContextAction(tradeId))}>{pending ? "Fetching…" : label}</Button>
      <Status pending={pending} result={result} busy="Fetching candles from the provider…" />
    </div>
  );
}

export function FetchMissingButton({ slow }: { slow: boolean }) {
  const { pending, result, runAction } = useContextAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" disabled={pending} onClick={() => runAction(fetchMissingContextAction)}>{pending ? "Fetching…" : "Fetch context for trades without it"}</Button>
      <Status pending={pending} result={result} busy={slow ? "Fetching… requests are spaced about 8 seconds apart for the Twelve Data free plan, so this can take a minute." : "Fetching candles from the provider…"} />
    </div>
  );
}
