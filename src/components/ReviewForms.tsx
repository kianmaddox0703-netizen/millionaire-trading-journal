"use client";
import { useActionState } from "react";
import { saveWeekly, saveMonthly } from "@/app/(app)/reviews/actions";
import { Button, Field, Textarea } from "@/components/ui";

export const WEEKLY_QUESTIONS: { group: string; items: [string, string][] }[] = [
  { group: "Process", items: [["followedRules", "Did I follow my rules?"], ["overtraded", "Did I overtrade?"], ["forcedSetups", "Did I force setups?"], ["respectedRisk", "Did I respect risk?"], ["followedPlan", "Did I follow my trading plan?"]] },
  { group: "Psychology", items: [["emotions", "What emotions appeared most often?"], ["lostDiscipline", "When did I lose discipline?"], ["triggers", "What triggered bad decisions?"]] },
  { group: "Improvement", items: [["keepDoing", "What should I continue?"], ["stopDoing", "What should I stop?"], ["change", "What should I change?"], ["focusNextWeek", "What is my one focus for next week?"]] },
];

export function WeeklyForm({ weekStart, values, completed }: { weekStart: string; values: Record<string, string>; completed: boolean }) {
  const [state, action, pending] = useActionState(saveWeekly, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="weekStart" value={weekStart} />
      {WEEKLY_QUESTIONS.map((g) => (
        <fieldset key={g.group}>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.group}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {g.items.map(([k, q]) => <Field key={k} label={q} className={k === "focusNextWeek" ? "md:col-span-2" : undefined}><Textarea name={k} defaultValue={values[k] ?? ""} rows={2} /></Field>)}
          </div>
        </fieldset>
      ))}
      <div className="flex items-center justify-end gap-2">
        {state?.ok && <span className="text-[12px] text-profit">Saved</span>}
        {state?.error && <span className="text-[12px] text-loss">{state.error}</span>}
        <Button disabled={pending}>Save draft</Button>
        <Button variant="primary" name="complete" value="1" disabled={pending}>{completed ? "Update review" : "Complete review"}</Button>
      </div>
    </form>
  );
}

export function MonthlyForm({ month, values }: { month: string; values: Record<string, string> }) {
  const [state, action, pending] = useActionState(saveMonthly, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      <Field label="Biggest improvement (in your words)"><Textarea name="biggestImprovement" defaultValue={values.biggestImprovement ?? ""} rows={2} /></Field>
      <Field label="Notes"><Textarea name="notes" defaultValue={values.notes ?? ""} rows={4} /></Field>
      <Field label="Focus for next month"><Textarea name="focusNextMonth" defaultValue={values.focusNextMonth ?? ""} rows={2} /></Field>
      <div className="flex items-center justify-end gap-2">{state?.ok && <span className="text-[12px] text-profit">Saved</span>}<Button variant="primary" disabled={pending}>Save</Button></div>
    </form>
  );
}
