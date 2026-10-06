"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { computeTrade } from "@/domain/metrics";
import { setupScore } from "@/domain/score";
import { SESSIONS, sessionOf } from "@/domain/sessions";
import type { TradeFormData } from "@/server/formdata";
import { saveTradeAction } from "@/app/(app)/trades/actions";
import { Button, Field, Input, Select, Textarea, Badge, Note, cx } from "@/components/ui";
import { ImageDrop, type StagedImage, uploadImages } from "./ImageDrop";
import { ScreenshotReadings, useScreenshotReader } from "@/components/ai/ScreenshotQuickEntry";
import { fmtNum, fmtR } from "@/lib/format";
import type { TradeFormValues } from "@/lib/tradeFormValues";
export type { TradeFormValues };

const NOTE_FIELDS: [string, string][] = [
  ["why", "Why did I take this trade?"], ["observed", "What did I see?"], ["thesis", "What was my thesis?"], ["whatHappened", "What happened?"],
  ["didWell", "What did I do well?"], ["didPoorly", "What did I do poorly?"], ["wouldChange", "What would I change?"], ["lesson", "Lesson learned"],
];
const PSYCH_FLAGS: [keyof TradeFormValues["psych"], string][] = [
  ["fomo", "Felt FOMO"], ["revenge", "Revenge trade"], ["movedStop", "Moved my stop"], ["exitedEarly", "Exited early"], ["overtraded", "Overtraded"], ["lateEntry", "Entered late"], ["oversized", "Oversized"],
];
const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "D", "W"];

function Section({ title, children, defaultOpen = false, badge }: { title: string; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left" aria-expanded={open}>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title} {badge}</span>
        <ChevronDown size={14} className={cx("text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-line p-3">{children}</div>}
    </section>
  );
}

/** aiReady: pass aiConfigured() from the page; false hides the "Read screenshot" buttons (undefined shows them and the server explains). */
export function TradeForm({ data, initial, tradeId, aiReady }: { data: TradeFormData; initial: TradeFormValues; tradeId?: string; aiReady?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<TradeFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [pending, start] = useTransition();
  const reader = useScreenshotReader();
  // direction always has a value; quick entry may only set it while the trader hasn't chosen one
  const [directionChosen, setDirectionChosen] = useState(Boolean(tradeId));
  const set = <K extends keyof TradeFormValues>(k: K, val: TradeFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const strategy = data.strategies.find((s) => s.id === v.strategyId);
  const preItems = strategy?.checklist.length ? strategy.checklist.map((c) => c.text) : data.defaultPre;
  const checklistValue = (phase: "pre" | "post", item: string) => v.checklist.find((c) => c.phase === phase && c.item === item);
  const setChecklist = (phase: "pre" | "post", item: string, patch: Partial<{ checked: boolean | null; answer: string | null }>) =>
    setV((p) => {
      const rest = p.checklist.filter((c) => !(c.phase === phase && c.item === item));
      const cur = p.checklist.find((c) => c.phase === phase && c.item === item) ?? { phase, item, checked: null, answer: null };
      return { ...p, checklist: [...rest, { ...cur, ...patch }] };
    });

  const preview = useMemo(
    () => computeTrade({
      direction: v.direction, entryPrice: Number(v.entryPrice) || 0, initialStop: num(v.initialStop), takeProfit: num(v.takeProfit),
      exitPrice: v.status === "closed" ? num(v.exitPrice) : null, netPnl: v.status === "closed" ? num(v.netPnl) : null,
      commission: num(v.commission), swap: num(v.swap), fees: num(v.fees), riskAmount: num(v.riskAmount),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.direction, v.entryPrice, v.initialStop, v.takeProfit, v.exitPrice, v.netPnl, v.commission, v.swap, v.fees, v.riskAmount, v.status],
  );
  const score = setupScore(data.factors, v.factors);
  const autoSession = v.openedAt ? sessionOf(new Date(v.openedAt)) : null;
  const preUnchecked = preItems.filter((i) => checklistValue("pre", i)?.checked !== true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (data.rules.requireChecklist && preUnchecked.length) {
      setError(`Your settings require the full pre-trade checklist. Unchecked: ${preUnchecked.join(", ")}.`);
      return;
    }
    const toIso = (s: string) => (s ? new Date(s).toISOString() : "");
    const payload = {
      ...v,
      openedAt: toIso(v.openedAt), closedAt: v.status === "closed" ? toIso(v.closedAt) : "",
      psych: { ...v.psych, followedPlan: v.psych.followedPlan || null },
      checklist: v.checklist.filter((c) => c.checked !== null || (c.answer ?? "").trim()),
    };
    start(async () => {
      const res = await saveTradeAction(payload, tradeId);
      if (!res.ok) {
        setError(res.error);
        setErrors(res.fieldErrors ?? {});
        return;
      }
      if (staged.length) {
        const up = await uploadImages(res.id, staged);
        if (up.failed.length) {
          setError(`Trade saved, but ${up.failed.length} image(s) failed: ${up.failed.join("; ")}`);
          router.push(`/trades/${res.id}`);
          return;
        }
      }
      router.push(`/trades/${res.id}`);
      router.refresh();
    });
  };

  const E = (k: string) => errors[k];
  const pnlHint = v.status === "closed" ? "Net P&L from your broker (after commission/swap). Leave blank to use price-based R." : undefined;

  return (
    <form onSubmit={submit} className="space-y-3" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e); }}>
      {/* QUICK ENTRY */}
      <section className="rounded-md border border-line bg-surface p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Field label="Symbol" error={E("symbol")}><Input autoFocus value={v.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} placeholder="EURUSD" required /></Field>
          <Field label="Direction">
            <div className="grid h-8 grid-cols-2 overflow-hidden rounded border border-line-strong">
              {(["long", "short"] as const).map((d) => (
                <button type="button" key={d} onClick={() => { set("direction", d); setDirectionChosen(true); }} className={cx("text-[13px] font-medium", v.direction === d ? (d === "long" ? "bg-profit/20 text-profit" : "bg-loss/20 text-loss") : "bg-surface-2 text-muted")}>{d === "long" ? "Long" : "Short"}</button>
              ))}
            </div>
          </Field>
          <Field label="Entry" error={E("entryPrice")}><Input className="num" inputMode="decimal" value={v.entryPrice} onChange={(e) => set("entryPrice", e.target.value)} placeholder="1.08250" required /></Field>
          <Field label="Stop loss" error={E("initialStop")}><Input className="num" inputMode="decimal" value={v.initialStop} onChange={(e) => set("initialStop", e.target.value)} placeholder="1.08150" /></Field>
          <Field label="Take profit" error={E("takeProfit")}><Input className="num" inputMode="decimal" value={v.takeProfit} onChange={(e) => set("takeProfit", e.target.value)} placeholder="1.08450" /></Field>
          <Field label="Status">
            <Select value={v.status} onChange={(e) => set("status", e.target.value as "open" | "closed")}><option value="closed">Closed</option><option value="open">Open</option></Select>
          </Field>
          <Field label="Strategy">
            <Select value={v.strategyId} onChange={(e) => setV((p) => ({ ...p, strategyId: e.target.value, setupId: "" }))}>
              <option value="">— none —</option>
              {data.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Setup">
            <Select value={v.setupId} onChange={(e) => set("setupId", e.target.value)} disabled={!strategy}>
              <option value="">— none —</option>
              {strategy?.setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Setup quality">
            <div className="grid h-8 grid-cols-4 overflow-hidden rounded border border-line-strong">
              {["A+", "A", "B", "C"].map((q) => (
                <button type="button" key={q} onClick={() => set("setupQuality", v.setupQuality === q ? "" : q)} className={cx("text-[12px] font-medium", v.setupQuality === q ? "bg-info/25 text-info" : "bg-surface-2 text-muted")}>{q}</button>
              ))}
            </div>
          </Field>
          <Field label="Opened" error={E("openedAt")}><Input type="datetime-local" value={v.openedAt} onChange={(e) => set("openedAt", e.target.value)} required /></Field>
          {v.status === "closed" && <Field label="Closed" error={E("closedAt")}><Input type="datetime-local" value={v.closedAt} onChange={(e) => set("closedAt", e.target.value)} /></Field>}
          <Field label="Account" error={E("accountId")}>
            <Select value={v.accountId} onChange={(e) => set("accountId", e.target.value)}>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          </Field>
          {v.status === "closed" && <>
            <Field label="Exit price" error={E("exitPrice")}><Input className="num" inputMode="decimal" value={v.exitPrice} onChange={(e) => set("exitPrice", e.target.value)} /></Field>
            <Field label="Net P&L $" hint={pnlHint} error={E("netPnl")}><Input className="num" inputMode="decimal" value={v.netPnl} onChange={(e) => set("netPnl", e.target.value)} placeholder="193.00" /></Field>
          </>}
          <Field label="Risk $" hint="Leave blank to infer from P&L and prices"><Input className="num" inputMode="decimal" value={v.riskAmount} onChange={(e) => set("riskAmount", e.target.value)} /></Field>
          <Field label="Lots"><Input className="num" inputMode="decimal" value={v.sizeLots} onChange={(e) => set("sizeLots", e.target.value)} /></Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-2 text-[12px]">
          <span className="text-muted">Planned R:R <span className="num text-fg">{preview.plannedRr !== null ? `1:${fmtNum(preview.plannedRr)}` : "—"}</span></span>
          {v.status === "closed" && <span className="text-muted">R <span className={cx("num", (preview.rMultiple ?? 0) >= 0 ? "text-profit" : "text-loss")}>{fmtR(preview.rMultiple)}</span>{preview.rBasis === "price" && <span className="text-faint"> (price-based)</span>}</span>}
          {preview.riskAmount !== null && <span className="text-muted">Risk <span className="num text-fg">${preview.riskAmount.toFixed(2)}</span></span>}
          {score !== null && <span className="text-muted">Setup score <span className="num text-fg">{score.toFixed(1)}/10</span></span>}
          {data.rules.minRr && preview.plannedRr !== null && preview.plannedRr < data.rules.minRr && <Badge tone="warn">Below your min R:R 1:{data.rules.minRr}</Badge>}
          {preview.warnings.map((w) => <Badge key={w} tone="warn">{w}</Badge>)}
        </div>
      </section>

      <Section title="Screenshots" defaultOpen badge={staged.length ? <Badge tone="info">{staged.length}</Badge> : null}>
        <ImageDrop staged={staged} setStaged={setStaged} onRead={aiReady === false ? undefined : reader.read} readingId={reader.busyId} />
        {reader.state && (
          <ScreenshotReadings
            state={reader.state} form={v} directionChosen={directionChosen} onClose={reader.clear}
            onApply={(patch) => { setV((p) => ({ ...p, ...patch })); if (patch.direction) setDirectionChosen(true); }}
          />
        )}
      </Section>

      <Section title="Context">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Session" hint={!v.session && autoSession ? `Auto: ${autoSession}` : undefined}>
            <Select value={v.session} onChange={(e) => set("session", e.target.value)}><option value="">Auto from time</option>{SESSIONS.map((s) => <option key={s}>{s}</option>)}</Select>
          </Field>
          <Field label="Timeframe"><Select value={v.timeframe} onChange={(e) => set("timeframe", e.target.value)}><option value="">—</option>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Market condition"><Select value={v.marketCondition} onChange={(e) => set("marketCondition", e.target.value)}><option value="">—</option>{["Trending", "Ranging", "Volatile", "Quiet", "News-driven"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Trend (entry TF)"><Select value={v.trend} onChange={(e) => set("trend", e.target.value)}><option value="">—</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="sideways">Sideways</option></Select></Field>
          <Field label="Higher-TF bias"><Select value={v.htfBias} onChange={(e) => set("htfBias", e.target.value)}><option value="">—</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="neutral">Neutral</option></Select></Field>
          <Field label="Entry confirmation" className="col-span-2"><Input value={v.entryConfirmation} onChange={(e) => set("entryConfirmation", e.target.value)} placeholder="e.g. Break & retest + engulfing" /></Field>
          <Field label="Confluences" hint="Comma-separated tags" className="col-span-2"><Input value={v.confluences} onChange={(e) => set("confluences", e.target.value)} placeholder="AOI, trend aligned, liquidity sweep" /></Field>
          <Field label="TradingView chart URL" error={E("chartUrl")}><Input value={v.chartUrl} onChange={(e) => set("chartUrl", e.target.value)} placeholder="https://www.tradingview.com/x/…" /></Field>
          <Field label="Commission"><Input className="num" inputMode="decimal" value={v.commission} onChange={(e) => set("commission", e.target.value)} placeholder="-7.00" /></Field>
          <Field label="Swap"><Input className="num" inputMode="decimal" value={v.swap} onChange={(e) => set("swap", e.target.value)} placeholder="0" /></Field>
          <Field label="Other fees / spread"><Input className="num" inputMode="decimal" value={v.fees} onChange={(e) => set("fees", e.target.value)} placeholder="0" /></Field>
        </div>
        <p className="mt-2 text-[11px] text-faint">Costs are signed like your broker reports them (costs negative). If you entered net P&L above, these are used to derive gross P&L.</p>
      </Section>

      <Section title="Pre-trade checklist" badge={<span className="num ml-1 text-faint">{preItems.length - preUnchecked.length}/{preItems.length}</span>}>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {preItems.map((item) => (
            <li key={item}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={checklistValue("pre", item)?.checked === true} onChange={(e) => setChecklist("pre", item, { checked: e.target.checked })} className="accent-[var(--color-info)]" />{item}</label></li>
          ))}
        </ul>
        {!data.rules.requireChecklist && <p className="mt-2 text-[11px] text-faint">Optional. You can require it in Settings → Risk rules.</p>}
      </Section>

      <Section title="Setup score">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.factors.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-2">
              <span className="text-[13px]">{f.label} <span className="num text-[11px] text-faint">{f.weight}%</span></span>
              <div className="grid h-7 w-48 grid-cols-4 overflow-hidden rounded border border-line-strong text-[11px]">
                {[[null, "—"], [0, "No"], [1, "Partial"], [2, "Clear"]].map(([val, lbl]) => (
                  <button type="button" key={String(lbl)} onClick={() => set("factors", { ...v.factors, [f.key]: val as number | null })} className={cx(v.factors[f.key] === val || (val === null && v.factors[f.key] === undefined) ? "bg-info/25 text-info" : "bg-surface-2 text-muted")}>{lbl as string}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-faint">Weights are yours (Settings). The score measures how complete the setup was by your definition. It is not a win probability.</p>
      </Section>

      <Section title="Psychology">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(["before", "during", "after"] as const).map((ph) => (
            <Field key={ph} label={`Emotion ${ph}`}>
              <Select value={v.emotions[ph]} onChange={(e) => set("emotions", { ...v.emotions, [ph]: e.target.value })}><option value="">—</option>{data.emotions.map((x) => <option key={x}>{x}</option>)}</Select>
            </Field>
          ))}
          <Field label="Confidence (1–10)"><Input type="number" min={1} max={10} value={v.psych.confidence} onChange={(e) => set("psych", { ...v.psych, confidence: e.target.value })} /></Field>
          <Field label="Discipline (1–10)"><Input type="number" min={1} max={10} value={v.psych.discipline} onChange={(e) => set("psych", { ...v.psych, discipline: e.target.value })} /></Field>
          <Field label="Followed my plan?">
            <Select value={v.psych.followedPlan} onChange={(e) => set("psych", { ...v.psych, followedPlan: e.target.value })}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {PSYCH_FLAGS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" className="accent-[var(--color-warn)]" checked={v.psych[k] as boolean} onChange={(e) => set("psych", { ...v.psych, [k]: e.target.checked })} />{label}</label>
          ))}
        </div>
      </Section>

      <Section title="Journal">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {NOTE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><Textarea rows={3} value={v.notes[k] ?? ""} onChange={(e) => set("notes", { ...v.notes, [k]: e.target.value })} /></Field>
          ))}
        </div>
      </Section>

      {v.status === "closed" && (
        <Section title="After-trade review">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.post.map((q) => q.startsWith("What") ? (
              <Field key={q} label={q} className="md:col-span-2"><Textarea rows={2} value={checklistValue("post", q)?.answer ?? ""} onChange={(e) => setChecklist("post", q, { answer: e.target.value })} /></Field>
            ) : (
              <div key={q} className="flex items-center justify-between gap-2 text-[13px]">
                <span>{q}</span>
                <div className="grid h-7 w-32 grid-cols-2 overflow-hidden rounded border border-line-strong text-[12px]">
                  {[true, false].map((b) => <button type="button" key={String(b)} onClick={() => setChecklist("post", q, { checked: b })} className={cx(checklistValue("post", q)?.checked === b ? "bg-info/25 text-info" : "bg-surface-2 text-muted")}>{b ? "Yes" : "No"}</button>)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Mistakes" badge={v.mistakes.length ? <Badge tone="warn">{v.mistakes.length}</Badge> : null}>
        <div className="flex flex-wrap gap-1.5">
          {data.mistakes.map((m) => {
            const on = v.mistakes.includes(m.key);
            return <button type="button" key={m.key} onClick={() => set("mistakes", on ? v.mistakes.filter((x) => x !== m.key) : [...v.mistakes, m.key])} className={cx("h-7 rounded border px-2 text-[12px]", on ? "border-warn/50 bg-warn-soft text-warn" : "border-line-strong bg-surface-2 text-muted hover:text-fg")}>{m.label}</button>;
          })}
        </div>
        <p className="mt-2 text-[11px] text-faint">Rule-based mistakes (oversizing, R:R below minimum, restricted times, loss limits, countertrend) are also detected automatically on save.</p>
      </Section>

      {error && <Note tone="loss">{error}</Note>}
      <div className="sticky bottom-0 -mx-3 flex items-center justify-end gap-2 border-t border-line bg-bg/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5">
        <span className="mr-auto hidden text-[11px] text-faint sm:inline">Ctrl/⌘ + Enter to save</span>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="primary" disabled={pending}>{pending ? "Saving…" : tradeId ? "Save changes" : "Save trade"}</Button>
      </div>
    </form>
  );
}
