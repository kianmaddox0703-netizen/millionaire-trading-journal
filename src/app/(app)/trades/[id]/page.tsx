import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { db, schema } from "@/server/db";
import { getRiskRules } from "@/server/trades";
import { loadTrades } from "@/server/analytics";
import { reviewTrade } from "@/domain/review";
import { MISTAKE_LABEL } from "@/domain/mistakes";
import { Card, PageHeader, Badge, LinkButton, Stat, StatGrid, StrengthBadge, Note, cx } from "@/components/ui";
import { Gallery } from "@/components/trade/Gallery";
import { DeleteTrade } from "@/components/trade/DeleteTrade";
import { fmtDate, fmtDuration, fmtMoney, fmtNum, fmtPrice, fmtR, fmtRate, tone, cap } from "@/lib/format";
import { config } from "@/server/config";

export const metadata = { title: "Trade" };

export default async function TradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, trades: scoped, tz } = await pageContext();
  const row = db.query.trades.findFirst({
    where: and(eq(schema.trades.id, id), eq(schema.trades.userId, user.id)),
    with: { notes: true, images: { orderBy: asc(schema.tradeImages.sort) }, mistakes: true, checklist: { orderBy: asc(schema.checklistResponses.sort) }, factors: true, account: true },
  }).sync();
  if (!row) notFound();
  // history for comparison is always the trade's own account
  const all = scoped.some((x) => x.id === id) ? scoped : loadTrades(user.id, tz);
  const t = all.find((x) => x.id === id)!;
  const history = all.filter((x) => x.accountId === t.accountId);
  const rules = getRiskRules(user.id);
  const review = reviewTrade(t, history, rules);
  const cur = row.account.currency;
  const factors = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, user.id)).all();
  const n = row.notes;
  const pre = row.checklist.filter((c) => c.phase === "pre");
  const post = row.checklist.filter((c) => c.phase === "post");
  const sim = review.similarity;

  return (
    <>
      <PageHeader
        title={`#${row.seq} · ${row.symbol} ${row.direction === "long" ? "Long" : "Short"}`}
        sub={<span className="flex flex-wrap items-center gap-2">
          {fmtDate(row.openedAt, tz)} → {row.closedAt ? fmtDate(row.closedAt, tz) : "open"} · {fmtDuration(row.openedAt, row.closedAt)} · {row.account.name}
          {t.strategyName && <Badge tone="info">{t.strategyName}{t.setupName ? ` · ${t.setupName}` : ""}</Badge>}
          {row.setupQuality && <Badge>{row.setupQuality}</Badge>}
          <Badge>{cap(row.source.replace("_", " "))}</Badge>
        </span>}
        actions={<><LinkButton href={`/trades/${id}/edit`}>Edit</LinkButton><DeleteTrade id={id} /></>}
      />

      <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <Card>
            <StatGrid cols={8}>
              <Stat label="Net P&L" value={fmtMoney(row.netPnl, cur, true)} valueClass={tone(row.netPnl)} sub={row.pnlPct !== null ? `${row.pnlPct.toFixed(2)}% of balance` : undefined} />
              <Stat label="R multiple" value={fmtR(row.status === "closed" ? row.rMultiple : null)} valueClass={tone(row.rMultiple)} sub={row.plannedRr !== null ? `planned 1:${fmtNum(row.plannedRr)}` : undefined} />
              <Stat label="Entry" value={fmtPrice(row.entryPrice)} />
              <Stat label="Stop loss" value={fmtPrice(row.initialStop)} />
              <Stat label="Take profit" value={fmtPrice(row.takeProfit)} />
              <Stat label="Exit" value={fmtPrice(row.exitPrice)} />
              <Stat label="Risk" value={fmtMoney(row.riskAmount, cur)} sub={row.riskPct !== null ? `${row.riskPct.toFixed(2)}%` : undefined} />
              <Stat label="Size" value={row.sizeLots !== null ? `${row.sizeLots} lots` : "—"} />
              <Stat label="Gross P&L" value={fmtMoney(row.grossPnl, cur, true)} />
              <Stat label="Commission" value={fmtMoney(row.commission, cur)} />
              <Stat label="Swap" value={fmtMoney(row.swap, cur)} />
              <Stat label="Fees" value={fmtMoney(row.fees, cur)} />
              <Stat label="Session" value={row.session ?? "—"} />
              <Stat label="Timeframe" value={row.timeframe ?? "—"} />
              <Stat label="Setup score" value={row.setupScore !== null ? `${row.setupScore.toFixed(1)}/10` : "—"} />
              <Stat label="Trade ID" value={<span className="text-[12px]">{row.externalRef ?? row.id.slice(-8)}</span>} />
            </StatGrid>
          </Card>

          <Card title="Screenshots"><Gallery tradeId={id} images={row.images.map((i) => ({ id: i.id, kind: i.kind, caption: i.caption, width: i.width, height: i.height }))} /></Card>

          <Card title="Journal">
            {n && [n.why, n.observed, n.thesis, n.whatHappened, n.didWell, n.didPoorly, n.wouldChange, n.lesson].some(Boolean) ? (
              <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                {([["Why did I take this trade?", n.why], ["What did I see?", n.observed], ["Thesis", n.thesis], ["What happened?", n.whatHappened], ["What I did well", n.didWell], ["What I did poorly", n.didPoorly], ["What I would change", n.wouldChange], ["Lesson learned", n.lesson]] as const).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k}><dt className="text-[11px] text-muted">{k}</dt><dd className="mt-0.5 whitespace-pre-wrap text-[13px]">{v}</dd></div>
                ))}
              </dl>
            ) : <div className="text-[12px] text-muted">No journal notes. <Link className="text-info" href={`/trades/${id}/edit`}>Add notes</Link></div>}
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Context">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                {([["Market condition", row.marketCondition], ["Trend", row.trend], ["Higher-TF bias", row.htfBias], ["Entry confirmation", row.entryConfirmation], ["Confluences", row.confluences || null]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-muted">{k}</dt><dd>{v ? cap(v) : <span className="text-faint">—</span>}</dd></div>
                ))}
                {row.chartUrl && <div className="col-span-2"><dt className="text-muted">Chart</dt><dd><a className="break-all text-info" href={row.chartUrl} target="_blank" rel="noreferrer noopener">{row.chartUrl}</a></dd></div>}
              </dl>
            </Card>
            <Card title="Psychology">
              <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
                <div><dt className="text-muted">Before</dt><dd>{t.emotionBefore ?? "—"}</dd></div>
                <div><dt className="text-muted">During</dt><dd>{t.emotionDuring ?? "—"}</dd></div>
                <div><dt className="text-muted">After</dt><dd>{t.emotionAfter ?? "—"}</dd></div>
                <div><dt className="text-muted">Confidence</dt><dd className="num">{t.confidence ?? "—"}</dd></div>
                <div><dt className="text-muted">Discipline</dt><dd className="num">{t.discipline ?? "—"}</dd></div>
                <div><dt className="text-muted">Followed plan</dt><dd>{t.followedPlan === null ? "—" : t.followedPlan ? "Yes" : "No"}</dd></div>
              </dl>
            </Card>
          </div>

          {(pre.length > 0 || post.length > 0 || row.factors.length > 0) && (
            <div className="grid gap-3 md:grid-cols-3">
              {pre.length > 0 && <Card title="Pre-trade checklist"><ul className="space-y-1 text-[12px]">{pre.map((c) => <li key={c.id} className={c.checked ? "" : "text-muted"}>{c.checked ? "☑" : "☐"} {c.item}</li>)}</ul></Card>}
              {post.length > 0 && <Card title="After-trade review"><ul className="space-y-1.5 text-[12px]">{post.map((c) => <li key={c.id}><span className="text-muted">{c.item}</span> {c.checked !== null && <b>{c.checked ? "Yes" : "No"}</b>}{c.answer && <div className="whitespace-pre-wrap">{c.answer}</div>}</li>)}</ul></Card>}
              {row.factors.length > 0 && <Card title="Setup score factors"><ul className="space-y-1 text-[12px]">{row.factors.map((f) => <li key={f.id} className="flex justify-between"><span className="text-muted">{factors.find((x) => x.key === f.factorKey)?.label ?? f.factorKey}</span><span>{["No", "Partial", "Clear"][f.rating]}</span></li>)}</ul></Card>}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Card title="Trade review">
            <p className="mb-2 text-[11px] text-faint">Generated from your data only: the fields on this trade and your own history.</p>
            {review.well.length > 0 && (<><div className="mb-1 text-[11px] font-medium text-profit">What you did well</div><ul className="mb-3 list-disc space-y-0.5 pl-4 text-[12px]">{review.well.map((w) => <li key={w}>{w}</li>)}</ul></>)}
            {review.issues.length > 0 && (<><div className="mb-1 text-[11px] font-medium text-warn">Potential issues</div><ul className="mb-3 list-disc space-y-0.5 pl-4 text-[12px]">{review.issues.map((w) => <li key={w}>{w}</li>)}</ul></>)}
            <div className="mb-1 text-[11px] font-medium text-info">Historical comparison</div>
            {sim.stat ? (
              <div className="space-y-1.5 text-[12px]">
                <p>This trade shares at least {sim.threshold} of {sim.traits.length} characteristics ({sim.traits.map((x) => x.value).join(", ")}) with <b>{sim.stat.n}</b> earlier trades.</p>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Win rate" value={fmtRate(sim.stat.winRate)} sub={`you overall ${fmtRate(sim.baseline.winRate)}`} />
                  <Stat label="Average R" value={fmtR(sim.stat.avgR)} valueClass={tone(sim.stat.avgR)} sub={`overall ${fmtR(sim.baseline.avgR)}`} />
                  <Stat label="Total" value={fmtR(sim.stat.totalR, 1)} valueClass={tone(sim.stat.totalR)} />
                </div>
                <StrengthBadge s={sim.stat.strength} n={sim.stat.n} />
                <p className="text-[11px] text-faint">Historical evidence only. It describes how similar trades went, not how this one will.</p>
              </div>
            ) : <p className="text-[12px] text-muted">{sim.traits.length < 2 ? "Tag strategy, setup, session or quality to compare with history." : "No earlier trades are similar enough yet."}</p>}
          </Card>

          <Card title="Mistakes">
            {row.mistakes.length ? (
              <ul className="space-y-2 text-[12px]">
                {row.mistakes.map((m) => (
                  <li key={m.id}>
                    <div className="flex items-center justify-between gap-2"><Badge tone="warn">{MISTAKE_LABEL[m.mistakeKey] ?? m.mistakeKey}</Badge><span className="text-[11px] text-faint">{m.source === "rule" ? "detected by rule" : "tagged by you"}</span></div>
                    {m.note && <div className="mt-0.5 text-muted">{m.note}</div>}
                    {m.costR !== null && m.costR > 0 && <div className="text-[11px] text-faint">Est. opportunity cost {m.costR.toFixed(2)}R (upper bound)</div>}
                  </li>
                ))}
              </ul>
            ) : <div className="text-[12px] text-muted">No mistakes recorded or detected.</div>}
          </Card>

          <Card title="AI analysis">
            {config.anthropicKey() ? <Note>AI screenshot analysis arrives in the next phase.</Note> : <Note tone="neutral">Not configured. Add <code>ANTHROPIC_API_KEY</code> on the server to enable screenshot analysis and AI trade reviews.</Note>}
          </Card>
        </div>
      </div>
    </>
  );
}
