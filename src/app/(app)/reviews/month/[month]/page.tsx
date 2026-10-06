import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { db, schema } from "@/server/db";
import { periodReport } from "@/domain/period";
import { addDays } from "@/domain/sessions";
import { summarize } from "@/domain/metrics";
import { PeriodView } from "@/components/PeriodView";
import { MonthlyForm } from "@/components/ReviewForms";
import { Card, PageHeader, LinkButton, Table, th, td, cx } from "@/components/ui";
import { AiPeriodCard } from "@/components/ai/AiPeriodCard";
import { fmtMoney, fmtR, fmtRate, fmtNum, tone } from "@/lib/format";

export const metadata = { title: "Monthly review" };
const shift = (m: string, d: number) => { const [y, mo] = m.split("-").map(Number); const t = new Date(Date.UTC(y, mo - 1 + d, 1)); return t.toISOString().slice(0, 7); };

export default async function Month({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();
  const { user, closed, currency, accountId, tz } = await pageContext();
  const prev = shift(month, -1);
  const of = (m: string) => closed.filter((t) => t.day.startsWith(m));
  const r = periodReport(of(month), of(prev));
  const saved = db.select().from(schema.monthlyReviews).where(and(eq(schema.monthlyReviews.userId, user.id), eq(schema.monthlyReviews.month, month))).get();
  const history = [0, -1, -2, -3, -4, -5].map((d) => shift(month, d)).map((m) => ({ m, s: summarize(of(m)), mistakes: of(m).reduce((a, t) => a + t.mistakes.length, 0) }));
  return (
    <>
      <PageHeader title={`Monthly review · ${month}`} actions={<><LinkButton href={`/reports?from=${month}-01&to=${addDays(`${shift(month, 1)}-01`, -1)}`}>PDF report</LinkButton><LinkButton href={`/reviews/month/${prev}`}>← Prev</LinkButton><LinkButton href={`/reviews/month/${shift(month, 1)}`}>Next →</LinkButton></>} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <PeriodView r={r} currency={currency} />
          <Card title="Compared with previous months" pad={false}>
            <Table>
              <thead><tr>{["Month", "Trades", "P&L", "Win rate", "Avg R", "Total R", "Profit factor", "Mistakes / trade"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{history.map(({ m, s, mistakes }) => (
                <tr key={m} className={m === month ? "bg-surface-2" : undefined}>
                  <td className={cx(td, "num")}>{m}</td><td className={cx(td, "num")}>{s.count}</td><td className={cx(td, "num", tone(s.netPnl))}>{fmtMoney(s.netPnl, currency, true)}</td>
                  <td className={cx(td, "num")}>{fmtRate(s.winRate)}</td><td className={cx(td, "num", tone(s.avgR))}>{fmtR(s.avgR)}</td><td className={cx(td, "num", tone(s.totalR))}>{fmtR(s.totalR, 1)}</td>
                  <td className={cx(td, "num")}>{fmtNum(s.profitFactor)}</td><td className={cx(td, "num")}>{s.count ? (mistakes / s.count).toFixed(2) : "—"}</td>
                </tr>
              ))}</tbody>
            </Table>
          </Card>
          <AiPeriodCard userId={user.id} kind="monthly" period={month} accountId={accountId} tz={tz} />
        </div>
        <Card title="Your notes"><MonthlyForm month={month} values={{ notes: saved?.notes ?? "", biggestImprovement: saved?.biggestImprovement ?? "", focusNextMonth: saved?.focusNextMonth ?? "" }} /></Card>
      </div>
    </>
  );
}
