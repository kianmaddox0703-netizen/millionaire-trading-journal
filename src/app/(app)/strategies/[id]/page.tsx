import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { db, schema } from "@/server/db";
import { summarize, equityCurve, maxDrawdown } from "@/domain/metrics";
import { strategyVerdict } from "@/domain/verdict";
import { findEdges, groupStats } from "@/domain/edge";
import { EDGE_DIMS } from "@/domain/insights";
import { dailyPnl } from "@/domain/report";
import { Card, PageHeader, Badge, LinkButton, Stat, StatGrid, StrengthBadge, Table, th, td, cx, Button } from "@/components/ui";
import { EquityChart } from "@/components/charts/Charts";
import { StrategyForm } from "@/components/StrategyForm";
import { fmtMoney, fmtNum, fmtR, fmtRate, tone } from "@/lib/format";
import { deleteStrategy } from "../actions";

export const metadata = { title: "Strategy" };

export default async function StrategyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const { edit } = await searchParams;
  const { user, closed, currency } = await pageContext();
  const s = db.query.strategies.findFirst({ where: and(eq(schema.strategies.id, id), eq(schema.strategies.userId, user.id)), with: { rules: { orderBy: asc(schema.strategyRules.sort) }, setups: true } }).sync();
  if (!s) notFound();
  const byKind = (k: string) => s.rules.filter((r) => r.kind === k);

  if (edit) {
    const txt = (k: string) => byKind(k).map((r) => r.text + (r.isRequired ? "" : " (optional)")).join("\n");
    return (
      <>
        <PageHeader title={`Edit ${s.name}`} actions={<form action={deleteStrategy.bind(null, s.id)}><Button variant="danger">Delete strategy</Button></form>} />
        <StrategyForm v={{ id: s.id, name: s.name, description: s.description, preferredSessions: s.preferredSessions, preferredPairs: s.preferredPairs, preferredConditions: s.preferredConditions, isActive: s.isActive, rule: txt("rule"), confirmation: txt("confirmation"), invalidation: txt("invalidation"), checklist: txt("checklist"), setups: s.setups.map((x) => x.name).join("\n") }} />
      </>
    );
  }

  const ts = closed.filter((t) => t.strategyId === id);
  const sum = summarize(ts);
  const curve = equityCurve(ts, 0);
  const dd = maxDrawdown(curve);
  const rs = ts.map((t) => t.rMultiple).filter((x): x is number => x !== null);
  const v = strategyVerdict(rs);
  const days = dailyPnl(ts);
  const best = days.reduce<(typeof days)[number] | null>((a, d) => (!a || d.value > a.value ? d : a), null);
  const worst = days.reduce<(typeof days)[number] | null>((a, d) => (!a || d.value < a.value ? d : a), null);
  const dims = Object.fromEntries(Object.entries(EDGE_DIMS).filter(([k]) => k !== "Strategy"));
  const edges = findEdges(ts, dims, sum.avgR, 5);
  const setupStats = groupStats(ts, (t) => t.setupName ?? "No setup", sum.avgR);

  const RuleList = ({ k, title }: { k: string; title: string }) => byKind(k).length ? (
    <div>
      <div className="mb-1 text-[11px] font-medium text-muted">{title}</div>
      <ul className="space-y-1 text-[12px]">
        {byKind(k).map((r) => (
          <li key={r.id} className="flex items-start gap-1.5">
            <span className="text-faint">•</span>
            <span className="flex-1">{r.text} {!r.isRequired && <span className="text-faint">(optional)</span>}</span>
            {r.kbConceptSlug && <Link href={`/strategies/knowledge#${r.kbConceptSlug}`} className="shrink-0 text-[11px] text-info">source</Link>}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <>
      <PageHeader title={s.name} sub={s.description} actions={<><LinkButton href={`/trades?strategyId=${s.id}`}>Trades</LinkButton><LinkButton href={`/strategies/${s.id}?edit=1`}>Edit</LinkButton></>} />
      <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <Card title="Does it work for me?" action={<Badge tone={v.tone}>{v.label}</Badge>}>
            <StatGrid cols={7}>
              <Stat label="Trades" value={sum.count} />
              <Stat label="Win rate" value={fmtRate(sum.winRate)} />
              <Stat label="Avg R" value={fmtR(sum.avgR)} valueClass={tone(sum.avgR)} sub={`median ${fmtR(sum.medianR)}`} />
              <Stat label="Profit factor" value={fmtNum(sum.profitFactor)} />
              <Stat label="Expectancy" value={fmtMoney(sum.expectancy, currency, true)} valueClass={tone(sum.expectancy)} sub={`${fmtR(sum.avgR)} / trade`} />
              <Stat label="Avg winner" value={fmtMoney(sum.avgWinner, currency)} valueClass="text-profit" sub={fmtR(sum.avgWinR)} />
              <Stat label="Avg loser" value={fmtMoney(sum.avgLoser, currency)} valueClass="text-loss" sub={fmtR(sum.avgLossR)} />
              <Stat label="Net P&L" value={fmtMoney(sum.netPnl, currency, true)} valueClass={tone(sum.netPnl)} />
              <Stat label="Max drawdown" value={`${fmtNum(dd.r, 1)}R`} sub={fmtMoney(dd.amount, currency)} />
              <Stat label="Best day" value={fmtMoney(best?.value, currency, true)} sub={best?.label} valueClass="text-profit" />
              <Stat label="Worst day" value={fmtMoney(worst?.value, currency, true)} sub={worst?.label} valueClass="text-loss" />
            </StatGrid>
            <p className="mt-2 text-[11px] text-faint">{v.detail}</p>
          </Card>
          {curve.length > 1 && <Card title="Strategy equity (cumulative)"><EquityChart points={curve} start={0} height={220} /></Card>}
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Best conditions"><Conditions items={edges.strongest.filter((c) => (c.stat.avgR ?? 0) > (sum.avgR ?? 0)).slice(0, 5)} /></Card>
            <Card title="Weak conditions"><Conditions items={edges.weakest.filter((c) => (c.stat.avgR ?? 0) < (sum.avgR ?? 0)).slice(0, 5)} /></Card>
          </div>
          <Card title="By setup" pad={false}>
            <Table>
              <thead><tr>{["Setup", "n", "Win rate", "Avg R", "Total R", "Net P&L", "Evidence"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{setupStats.map((g) => (
                <tr key={g.key}><td className={td}>{g.key}</td><td className={cx(td, "num")}>{g.n}</td><td className={cx(td, "num")}>{fmtRate(g.winRate)}</td><td className={cx(td, "num", tone(g.avgR))}>{fmtR(g.avgR)}</td><td className={cx(td, "num", tone(g.totalR))}>{fmtR(g.totalR, 1)}</td><td className={cx(td, "num", tone(g.netPnl))}>{fmtMoney(g.netPnl, currency, true)}</td><td className={td}><StrengthBadge s={g.strength} /></td></tr>
              ))}</tbody>
            </Table>
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="Definition">
            <div className="space-y-3">
              <RuleList k="rule" title="Rules" />
              <RuleList k="confirmation" title="Required confirmations" />
              <RuleList k="invalidation" title="Invalidations" />
              <RuleList k="checklist" title="Checklist" />
              <dl className="grid grid-cols-1 gap-1.5 text-[12px]">
                {s.preferredConditions && <div><dt className="text-muted">Preferred conditions</dt><dd>{s.preferredConditions}</dd></div>}
                {s.preferredSessions && <div><dt className="text-muted">Preferred sessions</dt><dd>{s.preferredSessions}</dd></div>}
                {s.preferredPairs && <div><dt className="text-muted">Preferred pairs</dt><dd>{s.preferredPairs}</dd></div>}
                <div><dt className="text-muted">Setups</dt><dd>{s.setups.map((x) => x.name).join(", ") || "—"}</dd></div>
              </dl>
              {s.source === "fxalexg_template" && <p className="text-[11px] text-faint">Built from source-backed FXAlexG concepts. Risk % and minimum R:R are not established from his material; set them in Settings → Risk rules.</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Conditions({ items }: { items: ReturnType<typeof findEdges>["strongest"] }) {
  if (!items.length) return <div className="text-[12px] text-muted">Not enough trades per condition yet.</div>;
  return (
    <ul className="space-y-2 text-[12px]">
      {items.map((c) => (
        <li key={c.stat.key} className="flex items-center justify-between gap-2">
          <span>{c.conditions.map((x) => x.value).join(" + ")}</span>
          <span className="flex items-center gap-2"><span className={cx("num", tone(c.stat.avgR))}>{fmtR(c.stat.avgR)}</span><StrengthBadge s={c.stat.strength} n={c.stat.n} /></span>
        </li>
      ))}
    </ul>
  );
}
