import Link from "next/link";
import { Suspense } from "react";
import { ImageIcon } from "lucide-react";
import { pageContext } from "@/server/page";
import { applyFilter, parseFilter } from "@/server/analytics";
import { filterOptions } from "@/server/filters";
import { summarize } from "@/domain/metrics";
import { MISTAKE_LABEL } from "@/domain/mistakes";
import { FilterBar } from "@/components/FilterBar";
import { Card, PageHeader, Table, th, td, Badge, Empty, LinkButton, Stat, StatGrid, cx } from "@/components/ui";
import { fmtDate, fmtMoney, fmtPrice, fmtR, fmtRate, fmtNum, fmtDuration, tone } from "@/lib/format";

export const metadata = { title: "Trades" };
const PAGE = 100;

export default async function TradesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, trades, tz, currency } = await pageContext();
  const f = parseFilter(sp);
  const rows = applyFilter(trades, f, MISTAKE_LABEL);
  const s = summarize(rows.filter((r) => r.status === "closed"));
  const page = Math.max(1, Number(sp.page) || 1);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const exportQs = new URLSearchParams(Object.entries(f) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Trade log"
        sub={`${rows.length} of ${trades.length} trades`}
        actions={<>
          <LinkButton href={`/api/export/trades?format=csv&${exportQs}`} prefetch={false}>Export CSV</LinkButton>
          <LinkButton href={`/api/export/trades?format=json&${exportQs}`} prefetch={false}>JSON</LinkButton>
          <LinkButton href="/trades/import">Import</LinkButton>
          <LinkButton variant="primary" href="/trades/new">Add trade</LinkButton>
        </>}
      />
      <Suspense><FilterBar options={filterOptions(user.id, trades)} showStatus /></Suspense>
      {rows.length > 0 && (
        <Card className="mb-3">
          <StatGrid cols={7}>
            <Stat label="Net P&L" value={fmtMoney(s.netPnl, currency, true)} valueClass={tone(s.netPnl)} />
            <Stat label="Trades" value={s.count} />
            <Stat label="Win rate" value={fmtRate(s.winRate)} />
            <Stat label="Avg R" value={fmtR(s.avgR)} valueClass={tone(s.avgR)} />
            <Stat label="Total R" value={fmtR(s.totalR, 1)} valueClass={tone(s.totalR)} />
            <Stat label="Profit factor" value={fmtNum(s.profitFactor)} />
            <Stat label="Expectancy" value={fmtMoney(s.expectancy, currency, true)} valueClass={tone(s.expectancy)} />
          </StatGrid>
        </Card>
      )}
      {rows.length === 0 ? (
        <Empty title={trades.length ? "No trades match these filters" : "No trades yet"}>
          {trades.length ? "Clear a filter to see more." : <LinkButton variant="primary" href="/trades/new">Add your first trade</LinkButton>}
        </Empty>
      ) : (
        <Card pad={false}>
          <Table>
            <thead>
              <tr>
                {["#", "Date", "Symbol", "Side", "Strategy / setup", "Q", "Entry", "SL", "TP", "Exit", "Risk", "Net P&L", "R", "Session", "Dur.", "Mistakes", ""].map((h) => (
                  <th key={h} className={cx(th, ["Entry", "SL", "TP", "Exit", "Risk", "Net P&L", "R"].includes(h) && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="group hover:bg-surface-2">
                  <td className={cx(td, "text-faint")}><Link href={`/trades/${t.id}`} className="num">{t.seq}</Link></td>
                  <td className={cx(td, "num text-muted")}><Link href={`/trades/${t.id}`}>{fmtDate(t.openedAt, tz)}</Link></td>
                  <td className={cx(td, "font-medium")}><Link href={`/trades/${t.id}`}>{t.symbol}</Link></td>
                  <td className={td}><Badge tone={t.direction === "long" ? "profit" : "loss"}>{t.direction === "long" ? "Long" : "Short"}</Badge></td>
                  <td className={cx(td, "max-w-[220px] truncate text-muted")}>{t.strategyName ?? <span className="text-faint">—</span>}{t.setupName && <span className="text-faint"> · {t.setupName}</span>}</td>
                  <td className={td}>{t.setupQuality ? <Badge tone={t.setupQuality === "C" ? "warn" : t.setupQuality.startsWith("A") ? "info" : "neutral"}>{t.setupQuality}</Badge> : <span className="text-faint">—</span>}</td>
                  <td className={cx(td, "num text-right")}>{fmtPrice(t.entryPrice)}</td>
                  <td className={cx(td, "num text-right text-muted")}>{fmtPrice(t.initialStop)}</td>
                  <td className={cx(td, "num text-right text-muted")}>{fmtPrice(t.takeProfit)}</td>
                  <td className={cx(td, "num text-right")}>{t.status === "open" ? <Badge tone="info">Open</Badge> : fmtPrice(t.exitPrice)}</td>
                  <td className={cx(td, "num text-right text-muted")}>{t.riskPct !== null ? `${t.riskPct.toFixed(2)}%` : "—"}</td>
                  <td className={cx(td, "num text-right", tone(t.netPnl))}>{fmtMoney(t.netPnl, currency, true)}</td>
                  <td className={cx(td, "num text-right font-medium", tone(t.rMultiple))}>{fmtR(t.rMultiple)}</td>
                  <td className={cx(td, "text-muted")}>{t.session ?? "—"}</td>
                  <td className={cx(td, "num text-muted")}>{fmtDuration(t.openedAt, t.closedAt)}</td>
                  <td className={cx(td, "max-w-[200px]")}>
                    <div className="flex gap-1 overflow-hidden">{t.mistakes.slice(0, 2).map((m) => <Badge key={m} tone="warn">{MISTAKE_LABEL[m] ?? m}</Badge>)}{t.mistakes.length > 2 && <Badge>+{t.mistakes.length - 2}</Badge>}</div>
                  </td>
                  <td className={td}>{t.hasImages && <ImageIcon size={13} className="text-faint" aria-label="Has screenshots" />}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {rows.length > PAGE && (
            <div className="flex items-center justify-between px-3 py-2 text-[12px] text-muted">
              <span>Page {page} of {Math.ceil(rows.length / PAGE)}</span>
              <div className="flex gap-2">
                {page > 1 && <Link href={{ query: { ...f, page: page - 1 } }} className="text-info">← Prev</Link>}
                {page * PAGE < rows.length && <Link href={{ query: { ...f, page: page + 1 } }} className="text-info">Next →</Link>}
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
