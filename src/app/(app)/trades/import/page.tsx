import { requireUser } from "@/server/auth";
import { selectedAccount } from "@/server/prefs";
import { userAccounts } from "@/server/analytics";
import { ImportWizard } from "@/components/ImportWizard";
import { Card, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Import trades" };

export default async function ImportPage() {
  const user = await requireUser();
  const accounts = userAccounts(user.id);
  const selected = (await selectedAccount(user.id)) ?? accounts[0]?.id ?? "";
  return (
    <>
      <PageHeader
        title="Import trades"
        sub="CSV, Excel or an MT5 trade history report. Nothing is saved until you confirm."
        actions={<LinkButton href="/settings/integrations">MT5 live sync and TradingView</LinkButton>}
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))} defaultAccount={selected} tz={user.timezone} />
        <div className="space-y-3">
          <Card title="Export from MT5">
            <ol className="list-decimal space-y-1 pl-4 text-[12px] text-muted">
              <li>In the MT5 desktop terminal open the <b className="text-fg">History</b> tab of the Toolbox.</li>
              <li>Right-click the list and choose <b className="text-fg">Positions</b>, then pick the period.</li>
              <li>Right-click again, choose <b className="text-fg">Report</b>, then <b className="text-fg">HTML</b> or <b className="text-fg">Open XML</b>.</li>
              <li>Drop the saved file here. Menu names can differ slightly between MT5 versions.</li>
            </ol>
          </Card>
          <Card title="What happens on import">
            <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted">
              <li>Each row is checked against trades already in the account: same broker ticket, or same symbol, direction, size, entry price and open time within 2 minutes.</li>
              <li>For each duplicate you choose: ignore it, merge the broker data into your journaled trade, or create it anyway.</li>
              <li>R is computed from the initial stop. MT5 only reports the last stop, so the report's opening orders are used when available. Stops already moved to breakeven are left empty instead of giving a wrong R.</li>
              <li>Session, P&L after costs, R and rule-based mistakes are calculated the same way as for trades you enter by hand.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
