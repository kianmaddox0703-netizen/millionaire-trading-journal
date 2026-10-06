"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

/** Analyze / Re-analyze one stored screenshot, then refresh the server-rendered card. */
export function ScreenshotAnalyzeButton({ imageId, label, hasAnalysis }: { imageId: string; label: string; hasAnalysis: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);

  const run = () =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch("/api/ai/screenshot/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId }) });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        setMsg(res.ok && j.ok ? { error: false, text: "Analysis updated." } : { error: true, text: j.error ?? `The analysis failed (${res.status}).` });
      } catch {
        setMsg({ error: true, text: "Couldn't reach the server." });
      }
      router.refresh();
    });

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={run} disabled={pending} data-screenshot-analyze={imageId}>
        {pending ? "Analyzing…" : hasAnalysis ? "Re-analyze" : "Analyze"}<span className="sr-only"> {label}</span>
      </Button>
      <span role="status" aria-live="polite" className={cx("text-[11px]", msg?.error && !pending ? "text-loss" : "text-muted")}>
        {pending ? "Reading the chart. This can take up to a minute." : msg?.text}
      </span>
    </div>
  );
}
