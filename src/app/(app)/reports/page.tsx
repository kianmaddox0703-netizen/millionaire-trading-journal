import Link from "next/link";
import { pageContext } from "@/server/page";
import { periodReport } from "@/domain/period";
import { equityCurve, maxDrawdown } from "@/domain/metrics";
import { groupStats } from "@/domain/edge";
import { addDays, weekStartOf, ymd } from "@/domain/sessions";
import { MISTAKE_LABEL } from "@/domain/mistakes";
import { PeriodView } from "@/components/PeriodView";
import { PrintButton } from "@/components/PrintButton";
import { EquityChart } from "@/components/charts/Charts";
import { Card, Field, Input, PageHeader, StrengthBadge, Table, th, td, cx, Button } from "@/components/ui";
import { fmtDate, fmtMoney, fmtNum, fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Performance report" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Printable report for a period (by close date). "Save as PDF" uses the browser's print-to-PDF,
 * with a light print palette; the app chrome is hidden when printing.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, tz, accountId, accounts, closed, start, currency } = await pageContext();
  const today = ymd(new Date(), tz);
  const presets: Record<string, [string, string]> = {
    week: [weekStartOf(today), today],
    month: [today.slice(0, 8) + "01", today],
    "90d": [addDays(today, -89), today],
    ytd: [today.slice(0, 5) + "01-01", today],
    all: [closed.reduce((m, t) => (t.day < m ? t.day : m), today), today],
  };
  const range = typeof sp.range === "string" && presets[sp.range] ? sp.range : undefined;
  let [from, to] = presets[range ?? "month"];
  if (!range && typeof sp.from === "string" && DAY.test(sp.from)) from = sp.from;
  if (!range && typeof sp.to === "string" && DAY.test(sp.to)) to = sp.to;
  if (from > to) [from, to] = [to, from];

  const inPeriod = closed.filter((t) => t.day >= from && t.day <= to);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  const prev = closed.filter((t) => t.day >= addDays(from, -days) && t.day < from);
  const r = periodReport(inPeriod, prev);
  const startBal = start + closed.filter((t) => t.day < from).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const curve = equityCurve(inPeriod, startBal);
  const dd = maxDrawdown(curve);
  const base = r.summary.avgR;
  const account = accountId ? accounts.find((a) => a.id === accountId)?.name : "All accounts";
  const tables: [string, (t: (typeof inPeriod)[number]) => string | null][] = [["Strategy", (t) => t.strategyName ?? "No strategy"], ["Session", (t) => t.session], ["Pair", (t) => t.symbol]];

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Performance report" sub="Choose a period, then save it as a PDF from the print dialog." actions={<PrintButton />} />
        <Card className="mb-3">
          <div className="flex flex-wrap items-end gap-2">
            {Object.keys(presets).map((k) => (
              <Link key={k} href={`/reports?range=${k}`} className={cx("inline-flex h-7 items-center rounded border px-2 text-[12px]", range === k ? "border-info bg-info-soft text-info" : "border-line-strong bg-surface-2 hover:bg-surface-3")}>
                {{ week: "This week", month: "This month", "90d": "Last 90 days", ytd: "Year to date", all: "All time" }[k]}
              </Link>
            ))}
            <form className="ml-auto flex flex-wrap items-end gap-2" action="/reports">
              <Field label="From"><Input type="date" name="from" defaultValue={from} className="w-[150px]" /></Field>
              <Field label="To"><Input type="date" name="to" defaultValue={to} className="w-[150px]" /></Field>
              <Button size="sm">Show</Button>
            </form>
          </div>
        </Card>
      </div>

      <article className="space-y-3">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2">
          <div>
            <h2 className="text-[16px] font-semibold">Trading performance · {from} to {to}</h2>
            <div className="text-[12px] text-muted">{user.name || user.email} · {account} · {currency} · times in {tz}</div>
          </div>
          <div className="text-[11px] text-muted">Generated {fmtDate(new Date(), tz)}</div>
        </header>

        {inPeriod.length === 0 ? <Card><p className="text-[12px] text-muted">No closed trades in this period.</p></Card> : (
          <>
            <PeriodView r={r} currency={currency} />
            <Card className="break-inside-avoid" title={`Equity · start ${fmtMoney(startBal, currency)} · max drawdown ${fmtMoney(dd.amount, currency)} (${fmtNum(dd.r, 1)}R)`}>
              <EquityChart points={curve} start={startBal} height={220} printWidth={680} />
            </Card>
            <div className="grid gap-3 lg:grid-cols-3 print:grid-cols-1">
              {tables.map(([label, fn]) => (
                <Card key={label} title={`By ${label.toLowerCase()}`} pad={false}>
                  <Table>
                    <thead><tr>{[label, "n", "Win rate", "Avg R", "Total R", "Net", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>{groupStats(inPeriod, fn, base).map((g) => (
                      <tr key={g.key}>
                        <td className={cx(td, "max-w-[160px] truncate")}>{g.key}</td><td className={cx(td, "num")}>{g.n}</td><td className={cx(td, "num")}>{fmtRate(g.winRate)}</td>
                        <td className={cx(td, "num", tone(g.avgR))}>{fmtR(g.avgR)}</td><td className={cx(td, "num", tone(g.totalR))}>{fmtR(g.totalR, 1)}</td>
                        <td className={cx(td, "num", tone(g.netPnl))}>{fmtMoney(g.netPnl, currency, true)}</td><td className={td}><StrengthBadge s={g.strength} /></td>
                      </tr>
                    ))}</tbody>
                  </Table>
                </Card>
              ))}
            </div>
            <Card title={`Trades (${inPeriod.length})`} pad={false}>
              <Table>
                <thead><tr>{["#", "Closed", "Trade", "Strategy", "Session", "R", "Net", "Mistakes"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{[...inPeriod].sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0)).map((t) => (
                  <tr key={t.id}>
                    <td className={cx(td, "num text-muted")}><Link href={`/trades/${t.id}`} className="hover:underline">{t.seq}</Link></td>
                    <td className={cx(td, "num")}>{fmtDate(t.closedAt, tz)}</td>
                    <td className={td}>{t.symbol} {t.direction === "long" ? "Long" : "Short"}</td>
                    <td className={cx(td, "max-w-[160px] truncate")}>{t.strategyName ?? "—"}</td>
                    <td className={td}>{t.session ?? "—"}</td>
                    <td className={cx(td, "num", tone(t.rMultiple))}>{fmtR(t.rMultiple)}</td>
                    <td className={cx(td, "num", tone(t.netPnl))}>{fmtMoney(t.netPnl, currency, true)}</td>
                    <td className={cx(td, "max-w-[220px] whitespace-normal text-[11px]")}>{t.mistakes.map((k) => MISTAKE_LABEL[k as keyof typeof MISTAKE_LABEL] ?? k).join(", ") || "—"}</td>
                  </tr>
                ))}</tbody>
              </Table>
            </Card>
          </>
        )}
        <p className="text-[11px] text-muted">Historical results from your own journal. They describe what happened, not what will happen. Evidence labels reflect sample size: groups under 10 trades are insufficient to draw conclusions.</p>
      </article>
    </>
  );
}
