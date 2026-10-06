import { pageContext } from "@/server/page";
import { summarize } from "@/domain/metrics";
import { groupStats, type GroupStat } from "@/domain/edge";
import { alignment } from "@/domain/insights";
import { biasAlignment } from "@/domain/marketContext";
import { providerStatus } from "@/server/marketdata/provider";
import { contextCounts, contextsByTrade, stateOf } from "@/server/marketdata/context";
import { Card, PageHeader, Note, Table, th, td, cx, StrengthBadge, Badge } from "@/components/ui";
import { ContextDefinitions } from "@/components/market/ContextDefinitions";
import { FetchMissingButton } from "@/components/market/ContextButtons";
import { fmtR, fmtRate, fmtMoney, tone, cap } from "@/lib/format";

export const metadata = { title: "Market Analysis" };

function StatsTable({ rows, currency }: { rows: GroupStat[]; currency: string }) {
  return (
    <Table>
      <thead><tr>{["Value", "n", "Win rate", "Avg R", "Total R", "Net P&L", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((g) => (
        <tr key={g.key}><td className={td}>{g.key}</td><td className={cx(td, "num")}>{g.n}</td><td className={cx(td, "num")}>{fmtRate(g.winRate)}</td><td className={cx(td, "num", tone(g.avgR))}>{fmtR(g.avgR)}</td><td className={cx(td, "num", tone(g.totalR))}>{fmtR(g.totalR, 1)}</td><td className={cx(td, "num", tone(g.netPnl))}>{fmtMoney(g.netPnl, currency, true)}</td><td className={td}><StrengthBadge s={g.strength} /></td></tr>
      ))}</tbody>
    </Table>
  );
}

export default async function Market() {
  const { user, closed, currency } = await pageContext();
  const base = summarize(closed).avgR;
  const provider = providerStatus();
  const counts = contextCounts(user.id);
  const ctx = contextsByTrade(user.id);
  type T = (typeof closed)[number];
  // only contexts that are current for the trade as it is now
  const auto = (t: T) => { const r = ctx.get(t.id); return r && stateOf(r, t) === "ok" ? r : null; };
  const autoSections: [string, (t: T) => string | null][] = [
    ["Auto HTF bias vs trade direction", (t) => biasAlignment(t.direction, auto(t)?.htfBias ?? null)],
    ["Auto volatility (H1 ATR vs its median)", (t) => { const v = auto(t)?.volatility; return v ? cap(v) : null; }],
    ["Near key level (auto)", (t) => { const v = auto(t)?.nearKeyLevel; return v === null || v === undefined ? null : v ? "Near key level" : "Not near a key level"; }],
  ];
  const decided = closed.filter((t) => t.netPnl !== null);
  const sections: [string, (t: T) => string | null][] = [
    ["Market condition", (t) => t.marketCondition],
    ["Higher-timeframe alignment", (t) => alignment(t)],
    ["Higher-timeframe bias", (t) => t.htfBias],
    ["Entry timeframe", (t) => t.timeframe],
    ["Direction", (t) => (t.direction === "long" ? "Long" : "Short")],
    ["Confluence", () => null],
  ];
  const showAuto = provider.ready || counts.ok > 0;
  return (
    <>
      <PageHeader title="Market Analysis" sub="How market conditions relate to your results." />
      <Card title="Automatic market context" action={<Badge tone={provider.ready ? "info" : provider.problem ? "warn" : "neutral"}>{provider.ready ? provider.label : provider.problem ? "Key missing" : "Not configured"}</Badge>}>
        <div className="space-y-3">
          {provider.id === "none" && (
            <Note tone="neutral">
              No market-data provider is configured, so trend, higher-timeframe bias, volatility and key levels come only from what you enter on each trade. To compute them from real historical candles, set MARKET_DATA_PROVIDER=oanda with OANDA_API_TOKEN and OANDA_ENV (practice or live), or MARKET_DATA_PROVIDER=twelvedata with TWELVEDATA_API_KEY, on the server. Nothing here is estimated or simulated.
            </Note>
          )}
          {provider.problem && <Note tone="warn">{provider.problem}</Note>}
          {(provider.ready || counts.ok + counts.error + counts.pending > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" data-testid="context-counts">
              {provider.ready && <span>Provider: <b>{provider.label}</b></span>}
              <span><span className="num">{counts.ok}</span> of <span className="num">{counts.total}</span> trades with context</span>
              {counts.pending > 0 && <span className="text-muted"><span className="num">{counts.pending}</span> pending</span>}
              {counts.error > 0 && <span className="text-loss"><span className="num">{counts.error}</span> with errors</span>}
              {counts.unsupported > 0 && <span className="text-muted"><span className="num">{counts.unsupported}</span> unsupported symbol{counts.unsupported === 1 ? "" : "s"}</span>}
              {counts.stale + counts.none > 0 && <span className="text-muted"><span className="num">{counts.stale + counts.none}</span> not fetched yet{counts.stale ? " or edited since" : ""}</span>}
            </div>
          )}
          {provider.ready && counts.missing > 0 && <FetchMissingButton slow={provider.id === "twelvedata"} />}
          {provider.ready && counts.missing === 0 && counts.total > 0 && <div className="text-[12px] text-muted">Every trade has current context or an unsupported symbol. New and edited trades are fetched automatically after saving.</div>}
          {provider.id === "twelvedata" && provider.ready && <div className="text-[11px] text-faint">Twelve Data&apos;s free plan allows 8 requests a minute and 800 a day, so each click fetches up to 6 trades, about 8 seconds apart.</div>}
          {showAuto && <ContextDefinitions />}
        </div>
      </Card>
      {showAuto && (
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
          {autoSections.map(([title, fn]) => {
            const rows = groupStats(closed, fn, base);
            const included = decided.filter((t) => fn(t) !== null).length;
            return (
              <Card key={title} title={title} pad={false}>
                {rows.length ? <StatsTable rows={rows} currency={currency} /> : <div className="p-3 text-[12px] text-muted">No closed trades with automatic context yet.</div>}
                <div className="border-t border-line px-3 py-1.5 text-[11px] text-faint">
                  {decided.length - included > 0 ? `${decided.length - included} of ${decided.length} closed trades excluded: no current automatic context.` : `All ${decided.length} closed trades included.`} Small groups are labelled by evidence strength; a few trades are not an edge.
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {sections.map(([title, fn]) => {
          const rows = title === "Confluence" ? groupStats(closed, (t) => t.confluences, base) : groupStats(closed, fn, base);
          return (
            <Card key={title} title={title} pad={false}>
              {rows.length ? <StatsTable rows={rows} currency={currency} /> : <div className="p-3 text-[12px] text-muted">No trades tagged with {title.toLowerCase()} yet.</div>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
