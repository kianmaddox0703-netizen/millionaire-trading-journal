import Link from "next/link";
import { pageContext } from "@/server/page";
import { summarize, equityCurve, maxDrawdown } from "@/domain/metrics";
import { dailyPnl, weeklyPnl, rHistogram, sumBy, sortByOrder, winLossDistribution } from "@/domain/report";
import { personalEdges, mistakeInsights } from "@/domain/insights";
import { SESSIONS, DAYS, ymd, weekStartOf } from "@/domain/sessions";
import { Card, Stat, StatGrid, PageHeader, Empty, LinkButton, StrengthBadge, cx } from "@/components/ui";
import { EquityChart, PnlBars, Histogram } from "@/components/charts/Charts";
import { fmtMoney, fmtPct, fmtR, fmtRate, fmtNum, tone } from "@/lib/format";

export const metadata = { title: "Dashboard" };

const RULE_KEYS = ["oversized", "low_rr", "restricted_time", "loss_limit", "overtrading", "outside_plan", "ignored_htf", "moved_stop"];

export default async function Dashboard() {
  const { closed, start, currency, tz, accountId, accounts } = await pageContext();
  if (!closed.length)
    return (
      <>
        <PageHeader title="Dashboard" />
        <Empty title="No closed trades yet">
          Add your first trade, or import your MT5 history from Settings. The dashboard fills in as you journal.
          <div className="mt-3 flex justify-center gap-2"><LinkButton variant="primary" href="/trades/new">Add trade</LinkButton><LinkButton href="/settings#import">Import</LinkButton></div>
        </Empty>
      </>
    );

  const s = summarize(closed);
  const curve = equityCurve(closed, start);
  const dd = maxDrawdown(curve);
  const balance = start + s.netPnl;
  const today = ymd(new Date(), tz);
  const wk = weekStartOf(today);
  const month = today.slice(0, 7);
  const sumP = (f: (d: string) => boolean) => closed.filter((t) => f(t.day)).reduce((a, t) => a + (t.netPnl ?? 0), 0);

  const count = (pred: (t: (typeof closed)[number]) => boolean) => closed.filter(pred).length;
  const has = (k: string) => (t: (typeof closed)[number]) => t.mistakes.includes(k);

  const edges = personalEdges(closed);
  const mistakesThisMonth = mistakeInsights(closed.filter((t) => t.day.startsWith(month)), edges.baselineAvgR);
  const topMistake = mistakesThisMonth[0];
  const dist = winLossDistribution(closed);
  const acctName = accountId ? accounts.find((a) => a.id === accountId)?.name : "All accounts";

  return (
    <>
      <PageHeader title="How am I trading?" sub={`${acctName} · ${s.count} closed trades`} />

      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <Card title="Performance">
            <StatGrid cols={7}>
              <Stat label="Account balance" value={fmtMoney(balance, currency)} sub={`start ${fmtMoney(start, currency)}`} />
              <Stat label="Net P&L" value={fmtMoney(s.netPnl, currency, true)} valueClass={tone(s.netPnl)} sub={fmtPct(start ? (s.netPnl / start) * 100 : null, 2, true) + " return"} />
              <Stat label="Today" value={fmtMoney(sumP((d) => d === today), currency, true)} valueClass={tone(sumP((d) => d === today))} />
              <Stat label="This week" value={fmtMoney(sumP((d) => d >= wk), currency, true)} valueClass={tone(sumP((d) => d >= wk))} />
              <Stat label="This month" value={fmtMoney(sumP((d) => d.startsWith(month)), currency, true)} valueClass={tone(sumP((d) => d.startsWith(month)))} />
              <Stat label="Win rate" value={fmtRate(s.winRate)} sub={`${s.wins}W ${s.losses}L ${s.breakevens}BE`} />
              <Stat label="Average R" value={fmtR(s.avgR)} valueClass={tone(s.avgR)} sub={`median ${fmtR(s.medianR)}`} />
              <Stat label="Profit factor" value={fmtNum(s.profitFactor)} valueClass={s.profitFactor !== null && s.profitFactor >= 1 ? "text-profit" : "text-loss"} />
              <Stat label="Expectancy" value={fmtMoney(s.expectancy, currency, true)} valueClass={tone(s.expectancy)} sub={`${fmtR(s.avgR)} / trade`} />
              <Stat label="Avg winner" value={fmtMoney(s.avgWinner, currency)} valueClass="text-profit" sub={fmtR(s.avgWinR)} />
              <Stat label="Avg loser" value={fmtMoney(s.avgLoser, currency)} valueClass="text-loss" sub={fmtR(s.avgLossR)} />
              <Stat label="Max drawdown" value={fmtPct(dd.pct, 2)} valueClass={dd.pct > 0 ? "text-loss" : undefined} sub={`${fmtMoney(dd.amount, currency)} · ${fmtNum(dd.r)}R`} />
              <Stat label="Current streak" value={s.currentStreak.length ? `${s.currentStreak.length} ${s.currentStreak.kind === "win" ? "W" : "L"}` : "—"} valueClass={s.currentStreak.kind === "win" ? "text-profit" : s.currentStreak.kind === "loss" ? "text-loss" : undefined} />
              <Stat label="Best streak" value={`${s.bestWinStreak} W`} sub={`worst ${s.worstLossStreak} L`} />
            </StatGrid>
          </Card>

          <Card title="Equity curve"><EquityChart points={curve} start={start} /></Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Daily P&L (last 30 trading days)"><PnlBars data={dailyPnl(closed).slice(-30).map((d) => ({ ...d, label: d.label.slice(5) }))} /></Card>
            <Card title="Weekly P&L"><PnlBars data={weeklyPnl(closed).slice(-16)} /></Card>
            <Card title="R-multiple distribution" action={<span className="text-[11px] text-muted">{dist.wins}W · {dist.losses}L · {dist.breakeven}BE</span>}><Histogram data={rHistogram(closed)} /></Card>
            <Card title="P&L by setup quality"><PnlBars data={sortByOrder(sumBy(closed, (t) => t.setupQuality ?? "Ungraded"), ["A+", "A", "B", "C", "Ungraded"])} /></Card>
            <Card title="P&L by strategy"><PnlBars horizontal data={sumBy(closed, (t) => t.strategyName ?? "No strategy").sort((a, b) => b.value - a.value)} /></Card>
            <Card title="P&L by pair"><PnlBars horizontal data={sumBy(closed, (t) => t.symbol).sort((a, b) => b.value - a.value).slice(0, 12)} /></Card>
            <Card title="P&L by session"><PnlBars data={sortByOrder(sumBy(closed, (t) => t.session), SESSIONS).map((d) => ({ ...d, label: d.label.replace("London/NY overlap", "LDN/NY") }))} /></Card>
            <Card title="P&L by day of week"><PnlBars data={sortByOrder(sumBy(closed, (t) => DAYS[t.dow]), DAYS)} /></Card>
          </div>
        </div>

        <div className="space-y-3">
          <Card title="Trading quality" pad={false}>
            <dl className="divide-y divide-line/60 text-[12px]">
              {[
                ["A+ setups taken", count((t) => t.setupQuality === "A+"), "/trades?quality=A%2B"],
                ["A setups taken", count((t) => t.setupQuality === "A"), "/trades?quality=A"],
                ["B setups taken", count((t) => t.setupQuality === "B"), "/trades?quality=B"],
                ["C setups taken", count((t) => t.setupQuality === "C"), "/trades?quality=C"],
                ["Trades outside strategy", count(has("outside_plan")), "/trades?mistake=outside_plan"],
                ["Rule violations", count((t) => t.mistakes.some((k) => RULE_KEYS.includes(k))), "/mistakes"],
                ["Revenge trades", count(has("revenge")), "/trades?mistake=revenge"],
                ["Overtrading", count(has("overtrading")), "/trades?mistake=overtrading"],
                ["FOMO trades", count(has("fomo")), "/trades?mistake=fomo"],
                ["Late entries", count(has("late_entry")), "/trades?mistake=late_entry"],
                ["Early exits", count(has("early_exit")), "/trades?mistake=early_exit"],
                ["Oversized positions", count(has("oversized")), "/trades?mistake=oversized"],
              ].map(([label, n, href], i) => (
                <Link key={label as string} href={href as string} className={cx("flex items-center justify-between px-3 py-1.5 hover:bg-surface-2", i === 4 && "border-t border-line")}>
                  <dt className="text-muted">{label}</dt>
                  <dd className={cx("num", i >= 4 && (n as number) > 0 ? "text-warn" : "text-fg")}>{n as number}</dd>
                </Link>
              ))}
            </dl>
          </Card>

          <Card title="Your #1 mistake this month">
            {topMistake ? (
              <div className="space-y-2 text-[12px]">
                <div className="flex items-baseline justify-between"><span className="text-[15px] font-medium">{topMistake.label}</span><span className="num text-muted">{topMistake.count}×</span></div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Realised cost" value={fmtR(topMistake.costR)} valueClass="text-loss" />
                  {topMistake.opportunityR > 0 && <Stat label="Est. opportunity" value={`−${topMistake.opportunityR.toFixed(1)}R`} hint="Planned R minus realised R on early exits (upper-bound estimate)" />}
                </div>
                {topMistake.mostCommon.length > 0 && (
                  <div className="text-muted">Most common on: {topMistake.mostCommon.map((m) => `${m.value} (${Math.round(m.share * 100)}%)`).join(" · ")}</div>
                )}
                <Link href={`/trades?mistake=${topMistake.key}`} className="text-info">See trades →</Link>
              </div>
            ) : <div className="text-[12px] text-muted">No mistakes logged this month.</div>}
          </Card>

          <Card title="Strongest conditions" action={<Link href="/performance#edge" className="text-[11px] text-info">Edge finder →</Link>}>
            <EdgeList items={edges.strongest.slice(0, 3)} />
          </Card>
          <Card title="Weakest conditions">
            <EdgeList items={edges.weakest.slice(0, 3)} />
          </Card>
        </div>
      </div>
    </>
  );
}

function EdgeList({ items }: { items: ReturnType<typeof personalEdges>["strongest"] }) {
  if (!items.length) return <div className="text-[12px] text-muted">Not enough trades per condition yet (need at least 5).</div>;
  return (
    <ul className="space-y-2.5">
      {items.map((c) => (
        <li key={c.stat.key} className="text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{c.conditions.map((x) => x.value).join(" + ")}</span>
            <span className={cx("num", tone(c.stat.avgR))}>{fmtR(c.stat.avgR)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2 text-muted">
            <span className="num">WR {fmtRate(c.stat.winRate)} · n={c.stat.n}</span>
            <StrengthBadge s={c.stat.strength} />
          </div>
        </li>
      ))}
    </ul>
  );
}
