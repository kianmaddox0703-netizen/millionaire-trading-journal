import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { contextFor, stateOf } from "@/server/marketdata/context";
import { providerStatus } from "@/server/marketdata/provider";
import { biasAlignment, LEVEL_LABEL } from "@/domain/marketContext";
import { priceOffsetLikely } from "@/domain/instruments";
import { Badge, Card, Note } from "@/components/ui";
import { cap, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { ContextDefinitions } from "./ContextDefinitions";
import { RefreshContextButton } from "./ContextButtons";

const PROVIDER_NAME: Record<string, string> = { oanda: "OANDA", twelvedata: "Twelve Data" };
const dirTone = (v: string | null) => (v === "bullish" ? "text-profit" : v === "bearish" ? "text-loss" : "text-fg");

/** Automatic market context for one trade (server component). Only the owner's rows are read. */
export async function MarketContextCard({ userId, tradeId, tz }: { userId: string; tradeId: string; tz: string }) {
  const trade = db.select({ symbol: schema.trades.symbol, openedAt: schema.trades.openedAt, entryPrice: schema.trades.entryPrice, direction: schema.trades.direction })
    .from(schema.trades).where(and(eq(schema.trades.id, tradeId), eq(schema.trades.userId, userId))).get();
  if (!trade) return null;
  const provider = providerStatus();
  const row = contextFor(userId, tradeId);
  const state = stateOf(row ?? undefined, { id: tradeId, ...trade });
  const badge = row ? <Badge tone={row.status === "ok" ? "info" : row.status === "error" ? "loss" : "neutral"}>{PROVIDER_NAME[row.provider] ?? row.provider}</Badge> : null;

  // the button keeps one position in the tree so its result message survives the re-render
  let body, refreshLabel = "Refresh";
  if (!row) {
    refreshLabel = "Fetch context";
    body = provider.ready ? <div className="text-[12px] text-muted">No automatic context for this trade yet.</div> : (
      <Note tone="neutral">
        {provider.problem ?? "Not configured: set MARKET_DATA_PROVIDER (oanda or twelvedata) and the provider's key on the server."} Trend, higher-timeframe bias, volatility and key levels are then computed for each trade from real historical candles. Nothing is estimated or simulated in the meantime.
      </Note>
    );
  } else if (row.status === "pending") {
    refreshLabel = "Fetch now";
    body = <Note tone="neutral">Queued, not fetched yet. {row.error ?? "Each save or import fetches a limited batch; the rest wait for the button on Market Analysis or for Fetch now here."}</Note>;
  } else if (row.status === "unsupported") {
    refreshLabel = "Try again";
    body = <Note tone="neutral">{row.error}</Note>;
  } else if (row.status === "error") {
    refreshLabel = "Retry";
    body = (
      <div className="space-y-1.5">
        <Note tone="loss">{row.error ?? "The market context could not be computed."}</Note>
        <div className="text-[11px] text-faint">{PROVIDER_NAME[row.provider] ?? row.provider}{row.instrument ? ` · ${row.instrument}` : ""} · last attempt {fmtDate(row.computedAt, tz)}</div>
      </div>
    );
  } else {
    const d = row.details?.computed;
    const align = biasAlignment(trade.direction, row.htfBias);
    const near = d?.key?.nearest;
    body = (
      <div className="space-y-3">
        {state === "stale" && <Note tone="warn">{row.details ? "The trade's symbol, entry time or entry price changed after this was computed. Refresh to recompute." : "The stored details couldn't be read. Refresh to recompute."}</Note>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px] sm:grid-cols-3">
          <div><dt className="text-muted">Trend (H1)</dt><dd className={dirTone(row.trend)}>{row.trend ? cap(row.trend) : "—"}</dd></div>
          <div>
            <dt className="text-muted">Higher-TF bias (H4)</dt>
            <dd className="flex flex-wrap items-center gap-1.5"><span className={dirTone(row.htfBias)}>{row.htfBias ? cap(row.htfBias) : "—"}</span>{align && <Badge tone={align === "With HTF bias" ? "profit" : align === "Against HTF bias" ? "warn" : "neutral"}>{align}</Badge>}</dd>
          </div>
          <div><dt className="text-muted">Volatility</dt><dd>{row.volatility ? cap(row.volatility) : "—"}{d?.vol && <span className="num text-faint"> · {fmtNum(d.vol.ratio)}× median ATR</span>}</dd></div>
          <div><dt className="text-muted">ATR14 (H1)</dt><dd className="num">{fmtPrice(row.atr)}</dd></div>
          <div>
            <dt className="text-muted">Near key level</dt>
            <dd>{row.nearKeyLevel === null ? "—" : row.nearKeyLevel ? "Yes" : "No"}{near && <span className="text-faint"> · nearest: {LEVEL_LABEL[near.kind].toLowerCase()} {fmtPrice(near.price)}, {fmtNum(near.distanceAtr)} ATR away</span>}</dd>
          </div>
          <div><dt className="text-muted">Session</dt><dd>{row.session ?? "—"}</dd></div>
        </dl>
        {d?.notes.length ? <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
        {priceOffsetLikely(trade.symbol) && <Note tone="neutral">Index, energy and crypto CFD prices differ between brokers and data providers, so the key-level distance compares your broker&apos;s entry price with the provider&apos;s candles.</Note>}
        <div className="text-[11px] text-faint">
          {PROVIDER_NAME[row.provider] ?? row.provider} · {row.instrument} · computed {fmtDate(row.computedAt, tz)}
          {d && <> · {d.candles.h1} H1 candles, {fmtDate(d.candles.from, tz)} to {fmtDate(d.candles.to, tz)}{d.key ? ` · ${d.key.levels.length} levels checked` : ""}</>}
        </div>
      </div>
    );
  }

  return (
    <Card title="Market context (automatic)" action={badge}>
      <div className="space-y-3">
        {body}
        {provider.ready && <RefreshContextButton tradeId={tradeId} label={refreshLabel} />}
        <ContextDefinitions />
      </div>
    </Card>
  );
}
