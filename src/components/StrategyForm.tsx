"use client";
import { useActionState } from "react";
import { saveStrategy } from "@/app/(app)/strategies/actions";
import { Button, Card, Field, Input, Textarea, Note } from "@/components/ui";

export interface StrategyValues {
  id?: string; name: string; description: string; preferredSessions: string; preferredPairs: string; preferredConditions: string; isActive: boolean;
  rule: string; confirmation: string; invalidation: string; checklist: string; setups: string;
}

export function StrategyForm({ v }: { v: StrategyValues }) {
  const [state, action, pending] = useActionState(saveStrategy, {});
  return (
    <form action={action} className="space-y-3">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Name"><Input name="name" defaultValue={v.name} required /></Field>
          <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={v.isActive} /> Active (shown in trade entry)</label>
          <Field label="Description" className="md:col-span-2"><Textarea name="description" defaultValue={v.description} rows={3} /></Field>
          <Field label="Preferred sessions"><Input name="preferredSessions" defaultValue={v.preferredSessions} placeholder="London, New York" /></Field>
          <Field label="Preferred pairs"><Input name="preferredPairs" defaultValue={v.preferredPairs} placeholder="EURUSD, GBPUSD" /></Field>
          <Field label="Preferred market conditions" className="md:col-span-2"><Input name="preferredConditions" defaultValue={v.preferredConditions} /></Field>
        </div>
      </Card>
      <Card title="Rules (one per line; add “(optional)” at the end of a line to mark it optional)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Rules"><Textarea name="rule" defaultValue={v.rule} rows={5} /></Field>
          <Field label="Required confirmations"><Textarea name="confirmation" defaultValue={v.confirmation} rows={5} /></Field>
          <Field label="Invalidations"><Textarea name="invalidation" defaultValue={v.invalidation} rows={5} /></Field>
          <Field label="Pre-trade checklist items" hint="Used as this strategy's checklist in trade entry"><Textarea name="checklist" defaultValue={v.checklist} rows={5} /></Field>
          <Field label="Setups" hint="One per line. Removing a setup un-tags its trades."><Textarea name="setups" defaultValue={v.setups} rows={4} /></Field>
        </div>
      </Card>
      {state?.error && <Note tone="loss">{state.error}</Note>}
      <div className="flex justify-end"><Button variant="primary" disabled={pending}>{pending ? "Saving…" : "Save strategy"}</Button></div>
    </form>
  );
}
