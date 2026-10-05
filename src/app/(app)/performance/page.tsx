import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { applyFilter, parseFilter } from "@/server/analytics";
import { filterOptions } from "@/server/filters";
import { db, schema } from "@/server/db";
import { summarize, equityCurve, maxDrawdown } from "@/domain/metrics";
import { groupStats, statFor, type GroupStat } from "@/domain/edge";
import { personalEdges, EDGE_DIMS } from "@/domain/insights";
import { rHistogram, sumBy, sortByOrder } from "@/domain/report";
import { MISTAKE_LABEL } from "@/domain/mistakes";
import { SESSIONS } from "@/domain/sessions";
import { FilterBar } from "@/components/FilterBar";
import { Card, PageHeader, Stat, StatGrid, Table, th, td, cx, StrengthBadge, Empty, Note } from "@/components/ui";
import { EquityChart, Histogram, PnlBars } from "@/components/charts/Charts";
import { fmtMoney, fmtNum, fmtPct, fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Performance" };

function StatTable({ rows, label }: { rows: GroupStat[]; label: string }) {
  return (
    <Table>
      <thead><tr>{[label, "n", "Win rate", "Avg R", "Median R", "Total R", "Expectancy $", "Net P&L", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((g) => (
        <tr key={g.key} className={cx("hover:bg-surface-2", g.n < 10 && "opacity-70")}>
          <td className={cx(td, "max-w-[200px] truncate")}>{g.key}</td><td className={cx(td, "num")}>{g.n}</td><td className={cx(td, "num")}>{fmtRate(g.winRate)}</td>
          <td className={cx(td, "num", tone(g.avgR))}>{fmtR(g.avgR)}</td><td className={cx(td, "num", tone(g.medianR))}>{fmtR(g.medianR)}</td><td className={cx(td, "num", tone(g.totalR))}>{fmtR(g.totalR, 1)}</td>
          <td className={cx(td, "num", tone(g.expectancy))}>{fmtMoney(g.expectancy, "USD", true)}</td><td className={cx(td, "num", tone(g.netPnl))}>{fmtMoney(g.netPnl, "USD", true)}</td><td className={td}><StrengthBadge s={g.strength} /></td>
        </tr>
      ))}</tbody>
    </Table>
  );
}

export default async function Performance({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { user, closed, start, currency } = await pageContext();
  const f = parseFilter(sp);
  const rows = applyFilter(closed, f, MISTAKE_LABEL);
  const filtered = Object.keys(f).length > 0;
  const s = summarize(rows);
  const curve = equityCurve(rows, filtered ? 0 : start);
  const dd = maxDrawdown(curve);
  const base = s.avgR;
  const edges = personalEdges(rows);
  const winners = rows.filter((t) => (t.netPnl ?? 0) > 0), losers = rows.filter((t) => (t.netPnl ?? 0) < 0);

  // Setup-score learning: for each factor, compare trades where it was clear vs absent.
  const ratings = db.select().from(schema.tradeFactorRatings).where(eq(schema.tradeFactorRatings.userId, user.id)).all();
  const factors = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, user.id)).all();
  const rmap = new Map<string, Record<string, number>>();
  for (const r of ratings) rmap.set(r.tradeId, { ...(rmap.get(r.tradeId) ?? {}), [r.factorKey]: r.rating });
  const factorRows = factors.map((fa) => {
    const clear = rows.filter((t) => rmap.get(t.id)?.[fa.key] === 2);
    const absent = rows.filter((t) => rmap.get(t.id)?.[fa.key] === 0);
    return { fa, clear: statFor("clear", clear, base), absent: statFor("absent", absent, base) };
  });

  return (
    <>
      <PageHeader title="Performance" sub={`${rows.length} closed trades${filtered ? " (filtered)" : ""}. Every number updates with the filters.`} />
      <Suspense><FilterBar options={filterOptions(user.id, closed)} /></Suspense>
      {!rows.length ? <Empty title="No trades match these filters" /> : (
        <div className="space-y-3">
          <Card>
            <StatGrid cols={8}>
              <Stat label="Net P&L" value={fmtMoney(s.netPnl, currency, true)} valueClass={tone(s.netPnl)} />
              <Stat label="Win rate" value={fmtRate(s.winRate)} sub={`${s.wins}W ${s.losses}L ${s.breakevens}BE`} />
              <Stat label="Avg R" value={fmtR(s.avgR)} valueClass={tone(s.avgR)} />
              <Stat label="Median R" value={fmtR(s.medianR)} valueClass={tone(s.medianR)} />
              <Stat label="Total R" value={fmtR(s.totalR, 1)} valueClass={tone(s.totalR)} />
              <Stat label="Profit factor" value={fmtNum(s.profitFactor)} />
              <Stat label="Expectancy" value={fmtMoney(s.expectancy, currency, true)} valueClass={tone(s.expectancy)} />
              <Stat label="Max drawdown" value={filtered ? `${fmtNum(dd.r, 1)}R` : fmtPct(dd.pct, 2)} sub={`${fmtMoney(dd.amount, currency)} · ${fmtNum(dd.r, 1)}R`} />
              <Stat label="Avg winner" value={fmtR(s.avgWinR)} valueClass="text-profit" sub={fmtMoney(s.avgWinner, currency)} />
              <Stat label="Avg loser" value={fmtR(s.avgLossR)} valueClass="text-loss" sub={fmtMoney(s.avgLoser, currency)} />
              <Stat label="Largest win" value={fmtMoney(s.largestWin, currency)} valueClass="text-profit" />
              <Stat label="Largest loss" value={fmtMoney(s.largestLoss, currency)} valueClass="text-loss" />
              <Stat label="Best streak" value={`${s.bestWinStreak} W`} />
              <Stat label="Worst streak" value={`${s.worstLossStreak} L`} />
              <Stat label="Payoff ratio" value={s.avgWinR !== null && s.avgLossR ? fmtNum(s.avgWinR / Math.abs(s.avgLossR)) : "—"} hint="Avg winner R ÷ |avg loser R|" />
              <Stat label="R per day traded" value={fmtR(s.totalR / Math.max(1, new Set(rows.map((t) => t.day)).size))} />
            </StatGrid>
          </Card>
          <Card title={filtered ? "Equity (filtered trades, from zero)" : "Equity curve"}><EquityChart points={curve} start={filtered ? 0 : start} height={280} /></Card>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card title="R-multiple distribution" className="lg:col-span-2"><Histogram data={rHistogram(rows)} height={220} /></Card>
            <Card title="Winners vs losers">
              <dl className="grid grid-cols-2 gap-3 text-[12px]">
                <Stat label="Winners" value={winners.length} sub={`avg ${fmtR(s.avgWinR)}`} valueClass="text-profit" />
                <Stat label="Losers" value={losers.length} sub={`avg ${fmtR(s.avgLossR)}`} valueClass="text-loss" />
                <Stat label="Losers worse than −1R" value={losers.filter((t) => (t.rMultiple ?? 0) < -1.05).length} hint="Losses beyond the planned stop (slippage, moved stop, costs)" valueClass="text-warn" />
                <Stat label="Winners ≥ 2R" value={winners.filter((t) => (t.rMultiple ?? 0) >= 2).length} />
              </dl>
              <p className="mt-3 text-[11px] text-faint">R normalises every trade by the risk you took, so execution quality is comparable across position sizes.</p>
            </Card>
            <Card title="R by strategy"><PnlBars horizontal unit="R" data={sumBy(rows, (t) => t.strategyName ?? "No strategy", "r").sort((a, b) => b.value - a.value)} /></Card>
            <Card title="R by session"><PnlBars unit="R" data={sortByOrder(sumBy(rows, (t) => t.session, "r"), SESSIONS).map((d) => ({ ...d, label: d.label.replace("London/NY overlap", "LDN/NY") }))} /></Card>
            <Card title="R by pair"><PnlBars horizontal unit="R" data={sumBy(rows, (t) => t.symbol, "r").sort((a, b) => b.value - a.value)} /></Card>
          </div>

          <Card title="Personal edge finder" className="scroll-mt-16" pad>
            <div id="edge" />
            <p className="mb-3 text-[12px] text-muted">Every single condition and pair of conditions with at least 5 trades, ranked by average R with small samples pulled toward your overall average ({fmtR(edges.baselineAvgR)}). Historical evidence only; it updates as you add trades.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              {([["Your strongest conditions", edges.strongest], ["Your weakest conditions", edges.weakest]] as const).map(([title, list]) => (
                <div key={title}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</div>
                  {list.length ? (
                    <ul className="space-y-2">
                      {list.map((c) => (
                        <li key={c.stat.key} className="rounded border border-line bg-surface-2 p-2 text-[12px]">
                          <div className="flex flex-wrap items-center gap-1.5">{c.conditions.map((x) => <span key={x.dim} className="rounded bg-surface-3 px-1.5 py-px"><span className="text-faint">{x.dim}:</span> {x.value}</span>)}</div>
                          <div className="num mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span>Win rate {fmtRate(c.stat.winRate)}</span>
                            <span className={tone(c.stat.avgR)}>Avg {fmtR(c.stat.avgR)}</span>
                            <span>Expectancy {fmtMoney(c.stat.expectancy, currency, true)}</span>
                            <span>Sample {c.stat.n}</span>
                            <StrengthBadge s={c.stat.strength} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="text-[12px] text-muted">Not enough trades per condition yet.</div>}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Setup-score factors: what correlates with your results" pad={false}>
            <Table>
              <thead><tr>{["Factor", "Weight", "Clear: n", "Clear: avg R", "Absent: n", "Absent: avg R", "Difference", "Evidence (clear)"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{factorRows.map(({ fa, clear, absent }) => {
                const diff = clear.avgR !== null && absent.avgR !== null ? clear.avgR - absent.avgR : null;
                return (
                  <tr key={fa.key}>
                    <td className={td}>{fa.label}</td><td className={cx(td, "num text-muted")}>{fa.weight}%</td>
                    <td className={cx(td, "num")}>{clear.n}</td><td className={cx(td, "num", tone(clear.avgR))}>{fmtR(clear.avgR)}</td>
                    <td className={cx(td, "num")}>{absent.n}</td><td className={cx(td, "num", tone(absent.avgR))}>{fmtR(absent.avgR)}</td>
                    <td className={cx(td, "num", tone(diff))}>{diff !== null ? fmtR(diff) : "—"}</td><td className={td}><StrengthBadge s={clear.strength} /></td>
                  </tr>
                );
              })}</tbody>
            </Table>
            <div className="p-3"><Note tone="neutral">Trades where a factor was clearly present vs absent. A large, well-sampled difference suggests raising that factor's weight in Settings. These are your historical results, not predictions.</Note></div>
          </Card>

          <div className="grid gap-3 xl:grid-cols-2">
            {Object.entries(EDGE_DIMS).map(([dim, fn]) => (
              <Card key={dim} title={`By ${dim.toLowerCase()}`} pad={false}><StatTable label={dim} rows={groupStats(rows, fn, base)} /></Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
