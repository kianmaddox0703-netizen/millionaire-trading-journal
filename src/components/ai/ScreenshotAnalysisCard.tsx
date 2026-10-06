import { Card, Note } from "@/components/ui";
import { aiConfigured } from "@/server/ai/client";
import { screenshotAnalysesForTrade } from "@/server/ai/screenshot";
import { fmtDate } from "@/lib/format";
import { ScreenshotAnalysisView } from "./ScreenshotAnalysisView";
import { ScreenshotAnalyzeButton } from "./ScreenshotAnalyzeButton";

const KIND_LABEL: Record<string, string> = { before: "Before entry", entry: "Entry", during: "During trade", exit: "Exit", tradingview: "TradingView", mt5: "MT5", other: "Other" };

/** AI screenshot analysis for one trade's images (server component). */
export async function ScreenshotAnalysisCard({ userId, tradeId, tz }: { userId: string; tradeId: string; tz: string }) {
  const states = screenshotAnalysesForTrade(userId, tradeId);
  const ready = aiConfigured();
  return (
    <Card title="Screenshot analysis">
      <p className="mb-2 text-[11px] text-faint">AI reading of your chart screenshots. What is visible, what is inferred and what the image can&apos;t show are kept apart; R:R and record mismatches are computed by the app from the readings.</p>
      {!ready && <div className="mb-2"><Note tone="neutral">Not configured: add ANTHROPIC_API_KEY on the server to analyze screenshots. Nothing is simulated without it.</Note></div>}
      {!states.length ? (
        <p className="text-[12px] text-muted">This trade has no screenshots yet. Add one under Screenshots to analyze it.</p>
      ) : (
        <ul className="space-y-4">
          {states.map((s, i) => {
            const label = `${KIND_LABEL[s.image.kind] ?? s.image.kind} screenshot${states.length > 1 ? ` ${i + 1}` : ""}`;
            const view = s.good && (
              <ScreenshotAnalysisView
                a={s.good.analysis}
                strategyChanged={s.good.strategyChanged}
                meta={{ model: s.good.row.model, at: fmtDate(s.good.row.createdAt, tz), inputTokens: s.good.row.inputTokens, outputTokens: s.good.row.outputTokens }}
              />
            );
            return (
              <li key={s.image.id} className="space-y-2 border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex items-start gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${s.image.id}?size=thumb`} alt="" className="h-12 w-20 shrink-0 rounded border border-line object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium">{label} <span className="num font-normal text-faint">{s.image.width}×{s.image.height}</span></div>
                    {s.image.caption && <div className="truncate text-[11px] text-muted">{s.image.caption}</div>}
                    {ready && <ScreenshotAnalyzeButton imageId={s.image.id} label={label} hasAnalysis={Boolean(s.good)} />}
                  </div>
                </div>
                {s.lastError && <Note tone="loss">Last attempt failed ({fmtDate(s.lastError.createdAt, tz)}): {s.lastError.error ?? "unknown error"}</Note>}
                {s.unreadable && !s.good && <Note tone="warn">An earlier analysis was saved in an older format and can&apos;t be shown. Re-analyze to refresh it.</Note>}
                {view
                  ? states.length > 1
                    ? <details open={i === 0}><summary className="cursor-pointer text-[11px] text-info">Analysis from {fmtDate(s.good!.row.createdAt, tz)}</summary><div className="mt-2">{view}</div></details>
                    : view
                  : !s.lastError && <p className="text-[12px] text-muted">Not analyzed yet.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
