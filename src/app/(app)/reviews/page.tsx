import Link from "next/link";
import { eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { db, schema } from "@/server/db";
import { summarize } from "@/domain/metrics";
import { weekStartOf, ymd, addDays } from "@/domain/sessions";
import { Card, PageHeader, Badge, Table, th, td, cx, LinkButton } from "@/components/ui";
import { fmtMoney, fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Reviews" };

export default async function Reviews() {
  const { user, closed, tz, currency } = await pageContext();
  const done = new Map(db.select().from(schema.weeklyReviews).where(eq(schema.weeklyReviews.userId, user.id)).all().map((w) => [w.weekStart, w]));
  const thisWeek = weekStartOf(ymd(new Date(), tz));
  const weeks = [...new Set([thisWeek, ...closed.map((t) => weekStartOf(t.day)), ...done.keys()])].sort().reverse().slice(0, 26);
  const months = [...new Set([ymd(new Date(), tz).slice(0, 7), ...closed.map((t) => t.day.slice(0, 7))])].sort().reverse().slice(0, 12);
  return (
    <>
      <PageHeader title="Reviews" sub="Weekly reviews close the loop: trade → journal → review → adjust." actions={<LinkButton variant="primary" href={`/reviews/week/${thisWeek}`}>Review this week</LinkButton>} />
      <div className="grid gap-3 xl:grid-cols-[1fr_360px]">
        <Card title="Weekly" pad={false}>
          <Table>
            <thead><tr>{["Week of", "Trades", "P&L", "Avg R", "Win rate", "Mistakes", "Focus", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {weeks.map((w) => {
                const ts = closed.filter((t) => t.day >= w && t.day <= addDays(w, 6));
                const s = summarize(ts);
                const r = done.get(w);
                return (
                  <tr key={w} className="hover:bg-surface-2">
                    <td className={td}><Link className="num text-info" href={`/reviews/week/${w}`}>{w}</Link></td>
                    <td className={cx(td, "num")}>{s.count}</td>
                    <td className={cx(td, "num", tone(s.netPnl))}>{fmtMoney(s.netPnl, currency, true)}</td>
                    <td className={cx(td, "num", tone(s.avgR))}>{fmtR(s.avgR)}</td>
                    <td className={cx(td, "num")}>{fmtRate(s.winRate)}</td>
                    <td className={cx(td, "num")}>{ts.reduce((a, t) => a + t.mistakes.length, 0)}</td>
                    <td className={cx(td, "max-w-[260px] truncate text-muted")}>{r?.focusNextWeek || "—"}</td>
                    <td className={td}>{r?.completedAt ? <Badge tone="profit">Done</Badge> : r ? <Badge tone="warn">Draft</Badge> : <Badge>Not started</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        <Card title="Monthly" pad={false}>
          <ul className="divide-y divide-line/60">
            {months.map((m) => {
              const s = summarize(closed.filter((t) => t.day.startsWith(m)));
              return (
                <li key={m}><Link href={`/reviews/month/${m}`} className="flex items-center justify-between px-3 py-2 text-[12px] hover:bg-surface-2">
                  <span className="num">{m}</span><span className="num text-muted">{s.count}t</span><span className={cx("num", tone(s.totalR))}>{fmtR(s.totalR, 1)}</span><span className={cx("num", tone(s.netPnl))}>{fmtMoney(s.netPnl, currency, true)}</span>
                </Link></li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
