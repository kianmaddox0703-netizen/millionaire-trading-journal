import Link from "next/link";
import { requireUser } from "@/server/auth";
import { config } from "@/server/config";
import { userAccounts } from "@/server/analytics";
import { webhookStatus, recentAlerts } from "@/server/tradingview";
import { bridgeConnections } from "@/server/mt5";
import { ALERT_TEMPLATE } from "@/domain/matching";
import { Badge, Card, LinkButton, Note, PageHeader, Table, th, td, cx } from "@/components/ui";
import { BridgeKeyForm, CopyBlock, RevokeKey, WebhookControls } from "@/components/Integrations";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const tz = user.timezone;
  const accounts = userAccounts(user.id);
  const hook = webhookStatus(user.id);
  const alerts = recentAlerts(user.id, 30);
  const bridges = bridgeConnections(user.id);
  const appUrl = config.appUrl().replace(/\/$/, "");
  const publicUrl = /^https:\/\//.test(appUrl) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(appUrl);
  const provider = config.marketDataProvider();

  return (
    <>
      <PageHeader title="Integrations" sub="Every integration here is real. Nothing places, changes or closes trades." actions={<LinkButton href="/settings">Back to settings</LinkButton>} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="File import" action={<Badge tone="profit">Ready</Badge>}>
          <p className="text-[12px] text-muted">CSV, Excel and MT5 trade history reports, with column mapping, a preview and duplicate handling before anything is saved.</p>
          <div className="mt-2"><LinkButton variant="primary" href="/trades/import">Import trades</LinkButton></div>
        </Card>

        <Card title="AI and market data">
          <ul className="space-y-2 text-[12px]">
            <li className="flex items-start justify-between gap-3"><span><b>AI coach and screenshot analysis.</b> <span className="text-muted">Needs <code>ANTHROPIC_API_KEY</code> on the server.</span></span><Badge tone={config.anthropicKey() ? "info" : "neutral"}>{config.anthropicKey() ? "Key present" : "Not configured"}</Badge></li>
            <li className="flex items-start justify-between gap-3"><span><b>Market data.</b> <span className="text-muted">Needs an account with a data provider (OANDA or Twelve Data). Not connected, so the Market Analysis page shows only your own notes and trades.</span></span><Badge>{provider === "none" ? "Not configured" : provider}</Badge></li>
          </ul>
        </Card>

        <Card title="MT5 live sync" action={<Badge tone={bridges.some((b) => b.lastSeenAt) ? "profit" : "neutral"}>{bridges.length ? `${bridges.length} key${bridges.length > 1 ? "s" : ""}` : "Not set up"}</Badge>}>
          <p className="mb-2 text-[12px] text-muted">
            MT5 has no web API for retail accounts, so a small read-only Python script runs on the Windows PC where your MT5 terminal is logged in.
            It reads your deal history and sends it here. It cannot place, change or close trades and never sees your broker password.
          </p>
          <ol className="mb-3 list-decimal space-y-1 pl-4 text-[12px] text-muted">
            <li>Install Python 3 for Windows, then run <code>pip install MetaTrader5</code>.</li>
            <li><a className="text-info underline" href="/api/bridge/mt5">Download mt5_bridge.py</a> and read it; it's short.</li>
            <li>Create a key below for the account to sync into, then run the commands it shows.</li>
          </ol>
          {accounts.length ? <BridgeKeyForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} appUrl={appUrl} /> : <Note tone="warn">Create an account first.</Note>}
          {bridges.length > 0 && (
            <Table className="mt-3">
              <thead><tr>{["Label", "Account", "Created", "Last sync", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{bridges.map((b) => (
                <tr key={b.id}>
                  <td className={td}>{b.label || "Bridge"}</td><td className={td}>{b.accountName}</td>
                  <td className={cx(td, "num")}>{fmtDate(b.createdAt, tz, false)}</td>
                  <td className={cx(td, "num")}>{b.lastSeenAt ? fmtDate(b.lastSeenAt, tz) : <span className="text-muted">never</span>}</td>
                  <td className={cx(td, "text-right")}><RevokeKey id={b.id} /></td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          <p className="mt-2 text-[11px] text-faint">Times from MT5 are server times. The bridge assumes the common UTC+2/UTC+3 New York close server clock; pass <code>--server-tz</code> if your broker differs. Positions opened before the first synced day are skipped, so run <code>--days 365</code> once for older history.</p>
        </Card>

        <Card title="TradingView alerts" action={<Badge tone={hook ? "profit" : "neutral"}>{hook ? "Webhook active" : "Not set up"}</Badge>}>
          <p className="mb-2 text-[12px] text-muted">
            TradingView alerts can post to a webhook URL. Each alert is stored here and matched to the trade you take afterwards
            (same symbol and direction, opened within 4 hours, entry near the alert price). Needs a TradingView plan with webhooks and 2-factor authentication turned on.
          </p>
          <WebhookControls exists={!!hook} publicUrl={publicUrl} />
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Alert message</div>
          <p className="mb-1 text-[12px] text-muted">In the TradingView alert dialog, paste the URL under Notifications → Webhook URL and this into Message. Change <code>side</code> and <code>setup</code> per alert.</p>
          <CopyBlock text={ALERT_TEMPLATE} label="Copy alert message" />
        </Card>
      </div>

      <Card title="Recent TradingView alerts" className="mt-3" pad={false}>
        {alerts.length ? (
          <Table>
            <thead><tr>{["Received", "Symbol", "TF", "Side", "Price", "Setup", "Message", "Trade"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.id}>
                <td className={cx(td, "num whitespace-nowrap")}>{fmtDate(a.alertTime ?? a.receivedAt, tz)}</td>
                <td className={td}>{a.symbol ?? "—"}</td><td className={td}>{a.timeframe ?? "—"}</td><td className={td}>{a.side ?? "—"}</td>
                <td className={cx(td, "num")}>{a.price ?? "—"}</td><td className={td}>{a.setup ?? "—"}</td>
                <td className={cx(td, "max-w-[280px] truncate")} title={a.message ?? ""}>{a.message ?? "—"}</td>
                <td className={td}>{a.link ? <Link className="underline" href={`/trades/${a.link.tradeId}`}>#{a.link.seq}</Link> : <span className="text-muted">no match yet</span>}
                  {a.link?.status === "suggested" && <Badge tone="warn" className="ml-1">check</Badge>}</td>
              </tr>
            ))}</tbody>
          </Table>
        ) : <div className="p-3 text-[12px] text-muted">No alerts received yet.</div>}
      </Card>
    </>
  );
}
