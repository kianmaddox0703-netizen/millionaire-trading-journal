import Link from "next/link";
import { pageContext } from "@/server/page";
import { summarize } from "@/domain/metrics";
import { mistakeInsights } from "@/domain/insights";
import { ymd } from "@/domain/sessions";
import { MISTAKES } from "@/domain/mistakes";
import { Card, PageHeader, Table, th, td, cx, Stat, StatGrid, StrengthBadge, Empty } from "@/components/ui";
import { PnlBars } from "@/components/charts/Charts";
import { fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Mistakes" };

export default async function Mistakes({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { closed, tz } = await pageContext();
  const { range = "month" } = await searchParams;
  const today = ymd(new Date(), tz);
  const from = range === "all" ? "" : range === "90d" ? ymd(Date.now() - 90 * 86400_000, tz) : today.slice(0, 7) + "-01";
  const ts = closed.filter((t) => t.day >= from);
  const base = summarize(ts);
  const list = mistakeInsights(ts, base.avgR);
  const clean = ts.filter((t) => !t.mistakes.length), dirty = ts.filter((t) => t.mistakes.length);
  const cs = summarize(clean), ds = summarize(dirty);
  const top = list[0];
  const tab = (k: string, l: string) => <Link href={`/mistakes?range=${k}`} className={cx("rounded px-2 py-1 text-[12px]", range === k ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}>{l}</Link>;

  return (
    <>
      <PageHeader title="Mistakes" sub="Analytical, not judgmental: what each mistake has cost you in R." actions={<div className="flex gap-1 rounded border border-line p-0.5">{tab("month", "This month")}{tab("90d", "90 days")}{tab("all", "All time")}</div>} />
      {!ts.length ? <Empty title="No trades in this range" /> : (
        <div className="space-y-3">
          <Card>
            <StatGrid cols={6}>
              <Stat label="Trades with a mistake" value={`${dirty.length} / ${ts.length}`} sub={ts.length ? `${Math.round((dirty.length / ts.length) * 100)}%` : undefined} />
              <Stat label="Avg R with mistake" value={fmtR(ds.avgR)} valueClass={tone(ds.avgR)} sub={`WR ${fmtRate(ds.winRate)}`} />
              <Stat label="Avg R clean trades" value={fmtR(cs.avgR)} valueClass={tone(cs.avgR)} sub={`WR ${fmtRate(cs.winRate)}`} />
              <Stat label="Total R on mistake trades" value={fmtR(ds.totalR, 1)} valueClass={tone(ds.totalR)} />
              <Stat label="Total R clean trades" value={fmtR(cs.totalR, 1)} valueClass={tone(cs.totalR)} />
              <Stat label="Distinct mistakes" value={list.length} />
            </StatGrid>
          </Card>
          {top && (
            <Card title={`Your #1 mistake ${range === "month" ? "this month" : range === "90d" ? "in 90 days" : "overall"}`}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                <div>
                  <div className="text-[20px] font-semibold">{top.label}</div>
                  <div className="num text-muted">{top.count} occurrences</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Stat label="Realised R on these trades" value={fmtR(top.costR, 1)} valueClass="text-loss" />
                    {top.opportunityR > 0 && <Stat label="Est. opportunity" value={`−${top.opportunityR.toFixed(1)}R`} hint="Planned R minus realised R (upper bound: assumes target would have been hit)" />}
                  </div>
                </div>
                <div className="text-[12px]">
                  <div className="mb-1 text-muted">Most common on</div>
                  <ul className="space-y-0.5">{top.mostCommon.map((m) => <li key={m.dim}><span className="text-muted">{m.dim}:</span> {m.value} <span className="num text-faint">({Math.round(m.share * 100)}%)</span></li>)}</ul>
                  <p className="mt-2 text-faint">{MISTAKES.find((m) => m.key === top.key)?.description}</p>
                  <Link className="mt-1 inline-block text-info" href={`/trades?mistake=${top.key}`}>Review these trades →</Link>
                </div>
              </div>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
            <Card title="All mistakes" pad={false}>
              <Table>
                <thead><tr>{["Mistake", "Count", "Win rate", "Avg R", "Realised R", "Est. opportunity", "Most common", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{list.map((m) => (
                  <tr key={m.key} className="hover:bg-surface-2">
                    <td className={td}><Link href={`/trades?mistake=${m.key}`} className="hover:text-info">{m.label}</Link></td>
                    <td className={cx(td, "num")}>{m.count}</td>
                    <td className={cx(td, "num")}>{fmtRate(m.stat.winRate)}</td>
                    <td className={cx(td, "num", tone(m.stat.avgR))}>{fmtR(m.stat.avgR)}</td>
                    <td className={cx(td, "num", tone(m.costR))}>{fmtR(m.costR, 1)}</td>
                    <td className={cx(td, "num text-muted")}>{m.opportunityR > 0 ? `−${m.opportunityR.toFixed(1)}R` : "—"}</td>
                    <td className={cx(td, "text-muted")}>{m.mostCommon[0] ? `${m.mostCommon[0].value}` : "—"}</td>
                    <td className={td}><StrengthBadge s={m.stat.strength} /></td>
                  </tr>
                ))}</tbody>
              </Table>
            </Card>
            <Card title="Realised R by mistake"><PnlBars horizontal unit="R" data={list.map((m) => ({ label: m.label, value: m.costR, n: m.count }))} /></Card>
          </div>
          <p className="text-[11px] text-faint">Realised R sums the losses on trades carrying a mistake; it doesn't claim the mistake caused the full loss. A trade can carry several mistakes.</p>
        </div>
      )}
    </>
  );
}
