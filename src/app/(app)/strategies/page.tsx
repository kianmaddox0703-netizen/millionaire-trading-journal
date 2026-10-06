import Link from "next/link";
import { eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { db, schema } from "@/server/db";
import { summarize, equityCurve, maxDrawdown } from "@/domain/metrics";
import { strategyVerdict } from "@/domain/verdict";
import { Card, PageHeader, Badge, LinkButton, Stat, Empty } from "@/components/ui";
import { Sparkline } from "@/components/charts/Charts";
import { fmtMoney, fmtNum, fmtR, fmtRate, tone } from "@/lib/format";

export const metadata = { title: "Strategies" };

export default async function Strategies() {
  const { user, closed, currency } = await pageContext();
  const list = db.select().from(schema.strategies).where(eq(schema.strategies.userId, user.id)).all();
  const none = closed.filter((t) => !t.strategyId);
  return (
    <>
      <PageHeader title="Strategies" sub="Does each strategy actually work for you?" actions={<><LinkButton href="/strategies/knowledge">FXAlexG knowledge base</LinkButton><LinkButton variant="primary" href="/strategies/new">New strategy</LinkButton></>} />
      {list.length === 0 && <Empty title="No strategies yet" />}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[...list.map((s) => ({ s, ts: closed.filter((t) => t.strategyId === s.id) })), ...(none.length ? [{ s: null, ts: none }] : [])].map(({ s, ts }) => {
          const sum = summarize(ts);
          const v = strategyVerdict(ts.map((t) => t.rMultiple).filter((x): x is number => x !== null));
          const dd = maxDrawdown(equityCurve(ts, 0));
          return (
            <Card key={s?.id ?? "none"} title={<span className="normal-case tracking-normal text-fg">{s ? <Link href={`/strategies/${s.id}`} className="text-[13px] hover:text-info">{s.name}</Link> : <span className="text-[13px]">Trades without a strategy</span>}</span>}
              action={<span className="flex items-center gap-1">{s?.source === "fxalexg_template" && <Badge tone="info">FXAlexG template</Badge>}{!s?.isActive && s && <Badge>Inactive</Badge>}<Badge tone={v.tone}>{v.label}</Badge></span>}>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                <Stat label="Trades" value={sum.count} />
                <Stat label="Win rate" value={fmtRate(sum.winRate)} />
                <Stat label="Avg R" value={fmtR(sum.avgR)} valueClass={tone(sum.avgR)} />
                <Stat label="Profit factor" value={fmtNum(sum.profitFactor)} />
                <Stat label="Expectancy" value={fmtMoney(sum.expectancy, currency, true)} valueClass={tone(sum.expectancy)} />
                <Stat label="Max DD" value={`${fmtNum(dd.r, 1)}R`} />
              </div>
              {ts.length > 1 && <div className="mt-2"><Sparkline values={equityCurve(ts, 0).map((p) => p.cumR)} /></div>}
              <p className="mt-1 text-[11px] text-faint">{v.detail}</p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
