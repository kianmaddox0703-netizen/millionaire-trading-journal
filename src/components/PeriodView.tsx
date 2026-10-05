import type { PeriodReport } from "@/domain/period";
import { Card, Stat, StatGrid, StrengthBadge } from "@/components/ui";
import { fmtMoney, fmtR, fmtRate, fmtNum, tone } from "@/lib/format";

export function PeriodView({ r, currency }: { r: PeriodReport; currency: string }) {
  const s = r.summary;
  const pair = (label: string, best: PeriodReport["best"][keyof PeriodReport["best"]], worst: PeriodReport["worst"][keyof PeriodReport["worst"]]) => (
    <div key={label} className="text-[12px]">
      <div className="text-[11px] text-muted">{label}</div>
      {best ? <div className="flex items-center justify-between gap-2"><span>▲ {best.key}</span><span className={`num ${tone(best.avgR)}`}>{fmtR(best.avgR)} · n={best.n}</span></div> : <div className="text-faint">—</div>}
      {worst && worst.key !== best?.key && <div className="flex items-center justify-between gap-2"><span>▼ {worst.key}</span><span className={`num ${tone(worst.avgR)}`}>{fmtR(worst.avgR)} · n={worst.n}</span></div>}
    </div>
  );
  return (
    <div className="space-y-3">
      <Card title="Performance">
        <StatGrid cols={6}>
          <Stat label="P&L" value={fmtMoney(s.netPnl, currency, true)} valueClass={tone(s.netPnl)} />
          <Stat label="Average R" value={fmtR(s.avgR)} valueClass={tone(s.avgR)} sub={`total ${fmtR(s.totalR, 1)}`} />
          <Stat label="Win rate" value={fmtRate(s.winRate)} sub={`${s.wins}W ${s.losses}L`} />
          <Stat label="Profit factor" value={fmtNum(s.profitFactor)} />
          <Stat label="Trades / days" value={`${s.count} / ${r.tradingDays}`} sub={`max ${r.maxTradesInDay} in a day`} />
          <Stat label="Followed plan" value={r.followedPlanPct !== null ? `${Math.round(r.followedPlanPct * 100)}%` : "—"} sub={r.avgRiskPct !== null ? `avg risk ${r.avgRiskPct.toFixed(2)}% · max ${r.maxRiskPct!.toFixed(2)}%` : undefined} />
        </StatGrid>
      </Card>
      <Card title="Summary from your data">
        {r.findings.length ? <ul className="list-disc space-y-1 pl-4 text-[12px]">{r.findings.map((f) => <li key={f}>{f}</li>)}</ul> : <div className="text-[12px] text-muted">No trades in this period.</div>}
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Best / worst">{<div className="space-y-2">{pair("Strategy", r.best.strategy, r.worst.strategy)}{pair("Setup", r.best.setup, r.worst.setup)}{pair("Pair", r.best.symbol, r.worst.symbol)}{pair("Session", r.best.session, r.worst.session)}</div>}</Card>
        <Card title="Mistakes">{r.mistakes.length ? <ul className="space-y-1 text-[12px]">{r.mistakes.slice(0, 8).map((m) => <li key={m.key} className="flex justify-between"><span>{m.label}</span><span className="num text-muted">{m.count}× · {fmtR(m.costR, 1)}</span></li>)}</ul> : <div className="text-[12px] text-muted">None recorded.</div>}</Card>
        <Card title="Emotions">{r.emotions.length ? <ul className="space-y-1 text-[12px]">{r.emotions.slice(0, 8).map((e) => <li key={e.emotion} className="flex justify-between"><span>{e.emotion}</span><span className="num text-muted">{e.count}</span></li>)}</ul> : <div className="text-[12px] text-muted">None recorded.</div>}</Card>
      </div>
      {r.best.setup && <div className="text-[11px] text-faint">Evidence strength for the best setup: <StrengthBadge s={r.best.setup.strength} n={r.best.setup.n} /></div>}
    </div>
  );
}
