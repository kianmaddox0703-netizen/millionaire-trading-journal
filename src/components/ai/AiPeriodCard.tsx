import { Badge, Card, Note } from "@/components/ui";
import { aiConfigured } from "@/server/ai/client";
import { periodSummaryState } from "@/server/ai/periodSummary";
import { validPeriod, type PeriodKind } from "@/domain/ai/period";
import { fmtDate } from "@/lib/format";
import { AiPeriodView } from "./AiPeriodView";
import { AiPeriodButton } from "./AiPeriodButton";

/**
 * AI summary for a week (Monday date) or month (YYYY-MM) in the page's account scope (server component).
 * It sits next to the trader's own review and never changes it.
 */
export async function AiPeriodCard({ userId, kind, period, accountId, tz }: { userId: string; kind: PeriodKind; period: string; accountId?: string; tz: string }) {
  if (!validPeriod(kind, period)) return null;
  const s = periodSummaryState(userId, kind, period, accountId);
  const ready = aiConfigured();
  const unit = kind === "weekly" ? "week" : "month";
  const good = s.good;
  return (
    <Card title={`AI ${kind} summary`} action={good ? <Badge tone="info">AI</Badge> : undefined}>
      <div className="space-y-3">
        <p className="text-[11px] text-faint">Written by AI from this {unit}&apos;s trades, the statistics above and your own answers, which it reads but never changes. Each point says what it rests on.</p>
        {!ready && <Note tone="neutral">Not configured: add ANTHROPIC_API_KEY on the server to write AI summaries. Nothing is simulated without it.</Note>}
        {good && s.outOfDate && <Note tone="warn">Out of date: trades or your written review changed after this summary. Regenerate to include the changes.</Note>}
        {s.lastError && <Note tone="loss">Last attempt failed ({fmtDate(s.lastError.createdAt, tz)}): {s.lastError.error ?? "unknown error"}</Note>}
        {s.unreadable && !good && <Note tone="warn">An earlier summary was saved in an older format and can&apos;t be shown. Regenerate to refresh it.</Note>}
        {good
          ? <AiPeriodView s={good.summary} meta={{ model: good.row.model, at: fmtDate(good.row.createdAt, tz), inputTokens: good.row.inputTokens, outputTokens: good.row.outputTokens }} />
          : !s.tradeCount ? <p className="text-[12px] text-muted">No closed trades in this {unit}, so there is nothing to summarize.</p>
          : ready && !s.lastError && <p className="text-[12px] text-muted">No AI summary yet.</p>}
        {ready && s.tradeCount > 0 && <AiPeriodButton kind={kind} period={period} scope={accountId ?? "all"} hasSummary={!!good} />}
      </div>
    </Card>
  );
}
