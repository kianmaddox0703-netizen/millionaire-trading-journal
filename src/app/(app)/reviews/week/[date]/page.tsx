import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { db, schema } from "@/server/db";
import { addDays, weekStartOf } from "@/domain/sessions";
import { periodReport } from "@/domain/period";
import { PeriodView } from "@/components/PeriodView";
import { WeeklyForm } from "@/components/ReviewForms";
import { Card, PageHeader, LinkButton, Badge } from "@/components/ui";
import { AiPeriodCard } from "@/components/ai/AiPeriodCard";

export const metadata = { title: "Weekly review" };

export default async function Week({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const w = weekStartOf(date);
  const { user, closed, currency, accountId, tz } = await pageContext();
  const end = addDays(w, 6), pw = addDays(w, -7);
  const r = periodReport(closed.filter((t) => t.day >= w && t.day <= end), closed.filter((t) => t.day >= pw && t.day < w));
  const saved = db.select().from(schema.weeklyReviews).where(and(eq(schema.weeklyReviews.userId, user.id), eq(schema.weeklyReviews.weekStart, w))).get();
  const values = saved ? Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, typeof v === "string" ? v : ""])) : {};
  return (
    <>
      <PageHeader title={`Week of ${w}`} sub={`${w} → ${end}`} actions={<><LinkButton href={`/reports?from=${w}&to=${end}`}>PDF report</LinkButton>
        {saved?.completedAt && <Badge tone="profit">Completed</Badge>}
        <LinkButton href={`/reviews/week/${pw}`}>← Prev</LinkButton><LinkButton href={`/reviews/week/${addDays(w, 7)}`}>Next →</LinkButton>
        <LinkButton href={`/trades?from=${w}&to=${end}`}>Trades</LinkButton></>} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <PeriodView r={r} currency={currency} />
          <AiPeriodCard userId={user.id} kind="weekly" period={w} accountId={accountId} tz={tz} />
        </div>
        <Card title="Your review"><WeeklyForm weekStart={w} values={values} completed={!!saved?.completedAt} /></Card>
      </div>
    </>
  );
}
