import { pageContext } from "@/server/page";
import { summarize } from "@/domain/metrics";
import { groupStats } from "@/domain/edge";
import { alignment } from "@/domain/insights";
import { config } from "@/server/config";
import { Card, PageHeader, Note, Table, th, td, cx, StrengthBadge, Badge } from "@/components/ui";
import { fmtR, fmtRate, fmtMoney, tone } from "@/lib/format";

export const metadata = { title: "Market Analysis" };

export default async function Market() {
  const { closed, currency } = await pageContext();
  const base = summarize(closed).avgR;
  const provider = config.marketDataProvider();
  const sections: [string, (t: (typeof closed)[number]) => string | null][] = [
    ["Market condition", (t) => t.marketCondition],
    ["Higher-timeframe alignment", (t) => alignment(t)],
    ["Higher-timeframe bias", (t) => t.htfBias],
    ["Entry timeframe", (t) => t.timeframe],
    ["Direction", (t) => (t.direction === "long" ? "Long" : "Short")],
    ["Confluence", (t) => null],
  ];
  return (
    <>
      <PageHeader title="Market Analysis" sub="How market conditions relate to your results." />
      <Card title="Automatic market context" action={<Badge tone={provider === "none" ? "neutral" : "info"}>{provider === "none" ? "Not configured" : provider}</Badge>}>
        {provider === "none" ? (
          <Note tone="neutral">
            No market-data provider is configured, so trend, volatility and key-level context come from what you enter on each trade. Session is always computed from the trade time. Fetching historical candles automatically needs a market-data provider account (an OANDA practice token or a Twelve Data key); that connection isn't built yet. Nothing here is estimated or simulated.
          </Note>
        ) : <Note tone="warn">A provider is selected, but its client isn't built yet, so no candles are fetched. It will be built and tested against your key.</Note>}
      </Card>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {sections.map(([title, fn]) => {
          const rows = title === "Confluence" ? groupStats(closed, (t) => t.confluences, base) : groupStats(closed, fn, base);
          return (
            <Card key={title} title={title} pad={false}>
              {rows.length ? (
                <Table>
                  <thead><tr>{["Value", "n", "Win rate", "Avg R", "Total R", "Net P&L", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>{rows.map((g) => (
                    <tr key={g.key}><td className={td}>{g.key}</td><td className={cx(td, "num")}>{g.n}</td><td className={cx(td, "num")}>{fmtRate(g.winRate)}</td><td className={cx(td, "num", tone(g.avgR))}>{fmtR(g.avgR)}</td><td className={cx(td, "num", tone(g.totalR))}>{fmtR(g.totalR, 1)}</td><td className={cx(td, "num", tone(g.netPnl))}>{fmtMoney(g.netPnl, currency, true)}</td><td className={td}><StrengthBadge s={g.strength} /></td></tr>
                  ))}</tbody>
                </Table>
              ) : <div className="p-3 text-[12px] text-muted">No trades tagged with {title.toLowerCase()} yet.</div>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
