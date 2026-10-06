import { Badge, Card, Note } from "@/components/ui";
import { aiConfigured } from "@/server/ai/client";
import { reviewBeingWritten, tradeReviewState } from "@/server/ai/review";
import { fmtDate } from "@/lib/format";
import { AiReviewView } from "./AiReviewView";
import { AiReviewButton, AiReviewMistakeButton } from "./AiReviewButtons";

/** AI trade review for one trade (server component). Only the owner's rows are read. */
export async function AiReviewCard({ userId, tradeId, tz }: { userId: string; tradeId: string; tz: string }) {
  const s = tradeReviewState(userId, tradeId);
  if (!s) return null;
  const ready = aiConfigured();
  const closed = s.trade.status === "closed";
  const good = s.good;
  const writing = reviewBeingWritten(tradeId);
  return (
    <Card title="AI trade review" action={good ? <Badge tone="info">AI</Badge> : undefined}>
      <div className="space-y-3">
        <p className="text-[11px] text-faint">Written by AI from this trade&apos;s records, your plan and your own history. Each point says what it rests on. It reviews the decision; it never predicts results.</p>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface-2 px-2 py-1.5 text-[12px]">
          <span><span className="text-muted">Setup score</span> <b className="num">{s.trade.setupScore !== null ? `${s.trade.setupScore.toFixed(1)}/10` : "—"}</b> <span className="text-[11px] text-faint">from your factor ratings ({s.factors.rated} of {s.factors.total} rated)</span></span>
          <span><span className="text-muted">Your grade</span> <b>{s.trade.setupQuality ?? "—"}</b></span>
        </div>
        <p className="-mt-2 text-[11px] text-faint">Computed by the app from your own ratings. The AI doesn&apos;t score setups.</p>

        {!ready && <Note tone="neutral">Not configured: add ANTHROPIC_API_KEY on the server to write AI trade reviews. Nothing is simulated without it.</Note>}
        {!closed && <p className="text-[12px] text-muted">The AI review is written once the trade is closed.</p>}
        {good && s.outOfDate && <Note tone="warn">Out of date: the trade changed after this review. Regenerate to review the current record.</Note>}
        {s.lastError && <Note tone="loss">Last attempt failed ({fmtDate(s.lastError.createdAt, tz)}): {s.lastError.error ?? "unknown error"}</Note>}
        {s.unreadable && !good && <Note tone="warn">An earlier review was saved in an older format and can&apos;t be shown. Regenerate to refresh it.</Note>}

        {good ? (
          <AiReviewView
            r={good.review}
            existingKeys={s.mistakeKeys}
            addAction={(key, label) => <AiReviewMistakeButton tradeId={tradeId} mistakeKey={key} label={label} />}
            meta={{ model: good.row.model, at: fmtDate(good.row.createdAt, tz), inputTokens: good.row.inputTokens, outputTokens: good.row.outputTokens }}
          />
        ) : closed && ready && !s.lastError && !writing && <p className="text-[12px] text-muted">No AI review yet.</p>}

        {writing
          ? <Note tone="neutral">The automatic review of this trade is being written. Reload the page in a minute to see it.</Note>
          : ready && closed && <AiReviewButton tradeId={tradeId} hasReview={!!good} />}
      </div>
    </Card>
  );
}
