import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { getRiskRules } from "@/server/trades";
import { config } from "@/server/config";
import { ActionForm } from "@/components/ActionForm";
import { Card, PageHeader, Field, Input, Select, Badge, Note, LinkButton } from "@/components/ui";
import { saveAccount, saveFactors, saveProfile, saveRiskRules, changePassword } from "./actions";

export const metadata = { title: "Settings" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Settings() {
  const user = await requireUser();
  const accounts = db.select().from(schema.accounts).where(eq(schema.accounts.userId, user.id)).all();
  const rules = getRiskRules(user.id);
  const factors = db.select().from(schema.scoreFactors).where(eq(schema.scoreFactors.userId, user.id)).orderBy(asc(schema.scoreFactors.sort)).all();
  const restricted = (rules.restrictedDays ?? "").split(",").filter(Boolean);
  const totalW = factors.reduce((a, f) => a + f.weight, 0);
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Risk rules">
          <ActionForm action={saveRiskRules}>
            <p className="mb-3 text-[12px] text-muted">Your own limits. Trades that break them are flagged as mistakes automatically (nothing is ever blocked or placed for you). Leave a field empty to disable that rule.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Max risk / trade %"><Input name="maxRiskPct" inputMode="decimal" defaultValue={n(rules.maxRiskPct)} /></Field>
              <Field label="Max daily loss %"><Input name="maxDailyLossPct" inputMode="decimal" defaultValue={n(rules.maxDailyLossPct)} /></Field>
              <Field label="Max weekly loss %"><Input name="maxWeeklyLossPct" inputMode="decimal" defaultValue={n(rules.maxWeeklyLossPct)} /></Field>
              <Field label="Max trades / day"><Input name="maxTradesPerDay" inputMode="numeric" defaultValue={n(rules.maxTradesPerDay)} /></Field>
              <Field label="Max consecutive losses"><Input name="maxConsecutiveLosses" inputMode="numeric" defaultValue={n(rules.maxConsecutiveLosses)} /></Field>
              <Field label="Minimum R:R (1:x)"><Input name="minRr" inputMode="decimal" defaultValue={n(rules.minRr)} /></Field>
              <Field label="Trading hours from" hint={`Your timezone: ${user.timezone}`}><Input type="time" name="tradingHoursStart" defaultValue={rules.tradingHoursStart ?? ""} /></Field>
              <Field label="Trading hours to"><Input type="time" name="tradingHoursEnd" defaultValue={rules.tradingHoursEnd ?? ""} /></Field>
            </div>
            <div className="mt-3 text-[11px] text-muted">Restricted days</div>
            <div className="mt-1 flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-[13px]"><input type="checkbox" name="restrictedDays" value={i} defaultChecked={restricted.includes(String(i))} />{d}</label>)}</div>
            <label className="mt-3 flex items-center gap-2 text-[13px]"><input type="checkbox" name="requireChecklist" defaultChecked={!!rules.requireChecklist} /> Require every pre-trade checklist item before saving a trade</label>
          </ActionForm>
        </Card>

        <Card title="Setup score weights">
          <ActionForm action={saveFactors}>
            <p className="mb-3 text-[12px] text-muted">These weights are your hypothesis, not trading truth. Performance → “Setup-score factors” shows which factors actually line up with your results, so you can adjust. Weights are relative (total now {totalW}).</p>
            <div className="space-y-2">
              {factors.map((f) => (
                <div key={f.id} className="grid grid-cols-[1fr_90px] gap-2">
                  <Input name={`l_${f.key}`} defaultValue={f.label} aria-label="Factor label" />
                  <Input name={`w_${f.key}`} defaultValue={f.weight} inputMode="decimal" aria-label={`${f.label} weight`} />
                </div>
              ))}
              <div className="grid grid-cols-[1fr_90px] gap-2 border-t border-line pt-2"><Input name="newLabel" placeholder="Add factor…" /><Input name="newWeight" placeholder="10" inputMode="decimal" /></div>
            </div>
          </ActionForm>
        </Card>

        <Card title="Accounts">
          <div className="space-y-3">
            {[...accounts, null].map((a) => (
              <ActionForm key={a?.id ?? "new"} action={saveAccount} submit={a ? "Save" : "Add account"} className="rounded border border-line bg-surface-2 p-2">
                {a && <input type="hidden" name="id" value={a.id} />}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Field label="Name"><Input name="name" defaultValue={a?.name ?? ""} placeholder="Prop Firm Account" required /></Field>
                  <Field label="Type"><Select name="kind" defaultValue={a?.kind ?? "live"}><option value="live">Live</option><option value="prop">Prop firm</option><option value="demo">Demo</option><option value="backtest">Backtest</option></Select></Field>
                  <Field label="Broker"><Input name="broker" defaultValue={a?.broker ?? ""} /></Field>
                  <Field label="Currency"><Input name="currency" defaultValue={a?.currency ?? "USD"} maxLength={3} /></Field>
                  <Field label="Starting balance"><Input name="startingBalance" inputMode="decimal" defaultValue={a?.startingBalance ?? 0} /></Field>
                </div>
                {a && <label className="mt-2 flex items-center gap-2 text-[12px] text-muted"><input type="checkbox" name="isArchived" defaultChecked={a.isArchived} /> Archived (hidden from dashboards)</label>}
              </ActionForm>
            ))}
          </div>
        </Card>

        <Card title="Profile">
          <ActionForm action={saveProfile}>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name"><Input name="name" defaultValue={user.name} /></Field>
              <Field label="Timezone" hint="Used for days, sessions and trading hours"><Input name="timezone" defaultValue={user.timezone} /></Field>
              <Field label="Base currency"><Input name="baseCurrency" defaultValue={user.baseCurrency} maxLength={3} /></Field>
            </div>
          </ActionForm>
          <div className="mt-4 border-t border-line pt-3">
            <ActionForm action={changePassword} submit="Change password">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Current password"><Input type="password" name="current" autoComplete="current-password" /></Field>
                <Field label="New password"><Input type="password" name="next" autoComplete="new-password" /></Field>
              </div>
            </ActionForm>
          </div>
        </Card>

        <Card title="Export">
          <div className="flex flex-wrap gap-2">
            <LinkButton prefetch={false} href="/api/export/trades?format=csv">Trades CSV</LinkButton>
            <LinkButton prefetch={false} href="/api/export/trades?format=json">Trades + journal JSON</LinkButton>
            <LinkButton prefetch={false} href="/api/export/reviews?format=json">Reviews JSON</LinkButton>
            <LinkButton prefetch={false} href="/api/export/reviews?format=csv">Reviews CSV</LinkButton>
          </div>
        </Card>

        <Card title="Integrations" className="scroll-mt-16" action={<LinkButton href="/settings/integrations">Manage</LinkButton>}>
          <div id="import" />
          <ul className="space-y-2 text-[12px]">
            <li className="flex items-center justify-between gap-2"><Link className="hover:underline" href="/trades/import">CSV, Excel and MT5 report import with duplicate detection</Link><Badge tone="profit">Ready</Badge></li>
            <li className="flex items-center justify-between gap-2"><Link className="hover:underline" href="/settings/integrations">MT5 live sync (read-only bridge on your Windows PC)</Link><Badge tone="profit">Ready</Badge></li>
            <li className="flex items-center justify-between gap-2"><Link className="hover:underline" href="/settings/integrations">TradingView webhook alerts and automatic matching</Link><Badge tone="profit">Ready</Badge></li>
            <li className="flex items-center justify-between gap-2"><span>Market data provider</span><Badge tone={config.marketDataProvider() === "none" ? "neutral" : "info"}>{config.marketDataProvider() === "none" ? "Not configured" : config.marketDataProvider()}</Badge></li>
            <li className="flex items-center justify-between gap-2"><span>AI (screenshot analysis, coach)</span><Badge tone={config.anthropicKey() ? "info" : "neutral"}>{config.anthropicKey() ? "Key present" : "Not configured"}</Badge></li>
          </ul>
          <Note tone="neutral">Integrations are not simulated. MT5 and TradingView need the setup steps on the Integrations page before they receive anything.</Note>
        </Card>
      </div>
    </>
  );
}
