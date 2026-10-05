import { eq } from "drizzle-orm";
import { getUser } from "@/server/auth";
import { applyFilter, loadTrades, parseFilter } from "@/server/analytics";
import { db, schema } from "@/server/db";
import { MISTAKE_LABEL } from "@/domain/mistakes";
import { toCsv } from "@/lib/csv";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const f = parseFilter(Object.fromEntries(url.searchParams));
  const trades = applyFilter(loadTrades(user.id, user.timezone), f, MISTAKE_LABEL);
  const stamp = new Date().toISOString().slice(0, 10);
  if (url.searchParams.get("format") === "json") {
    const notes = new Map(db.select().from(schema.tradeNotes).where(eq(schema.tradeNotes.userId, user.id)).all().map((n) => [n.tradeId, n]));
    const body = trades.map(({ notesText: _n, ...t }) => {
      const { tradeId: _t, userId: _u, updatedAt: _d, ...journal } = notes.get(t.id) ?? ({} as Record<string, unknown>);
      return { ...t, journal };
    });
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), count: body.length, trades: body }, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="trades-${stamp}.json"` },
    });
  }
  const rows = trades.map((t) => ({
    trade_no: t.seq, account: t.accountName, symbol: t.symbol, direction: t.direction, status: t.status, opened_at: t.openedAt, closed_at: t.closedAt,
    entry: t.entryPrice, stop: t.initialStop, take_profit: t.takeProfit, exit: t.exitPrice, lots: t.sizeLots, risk: t.riskAmount, risk_pct: t.riskPct,
    commission: t.commission, swap: t.swap, net_pnl: t.netPnl, pnl_pct: t.pnlPct, r_multiple: t.rMultiple, planned_rr: t.plannedRr, setup_score: t.setupScore,
    session: t.session, timeframe: t.timeframe, strategy: t.strategyName, setup: t.setupName, quality: t.setupQuality, market_condition: t.marketCondition,
    trend: t.trend, htf_bias: t.htfBias, confluences: t.confluences, emotion_before: t.emotionBefore, emotion_during: t.emotionDuring, emotion_after: t.emotionAfter,
    confidence: t.confidence, discipline: t.discipline, followed_plan: t.followedPlan, mistakes: t.mistakes.map((m) => MISTAKE_LABEL[m] ?? m),
  }));
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trades-${stamp}.csv"` } });
}
