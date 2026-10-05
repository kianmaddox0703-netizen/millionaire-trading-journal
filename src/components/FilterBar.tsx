"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

export interface FilterOptions {
  symbols: string[];
  strategies: { id: string; name: string }[];
  setups: { id: string; name: string }[];
  sessions: string[];
  timeframes: string[];
  emotions: string[];
  mistakes: { key: string; label: string }[];
}

const sel = "h-7 rounded border border-line bg-surface px-1.5 text-[12px] text-fg focus:border-info focus:outline-none";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function FilterBar({ options, showStatus = false }: { options: FilterOptions; showStatus?: boolean }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v); else p.delete(k);
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };
  const v = (k: string) => sp.get(k) ?? "";
  const active = [...sp.keys()].filter((k) => k !== "page").length;
  const S = ({ k, label, children }: { k: string; label: string; children: React.ReactNode }) => (
    <select aria-label={label} className={sel} value={v(k)} onChange={(e) => set(k, e.target.value)}>
      <option value="">{label}</option>
      {children}
    </select>
  );
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <input type="date" aria-label="From" className={sel} value={v("from")} onChange={(e) => set("from", e.target.value)} />
      <span className="text-faint">–</span>
      <input type="date" aria-label="To" className={sel} value={v("to")} onChange={(e) => set("to", e.target.value)} />
      <S k="symbol" label="Symbol">{options.symbols.map((s) => <option key={s}>{s}</option>)}</S>
      <S k="strategyId" label="Strategy">{options.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</S>
      <S k="setupId" label="Setup">{options.setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</S>
      <S k="session" label="Session">{options.sessions.map((s) => <option key={s}>{s}</option>)}</S>
      <S k="direction" label="Direction"><option value="long">Long</option><option value="short">Short</option></S>
      <S k="timeframe" label="Timeframe">{options.timeframes.map((s) => <option key={s}>{s}</option>)}</S>
      <S k="emotion" label="Emotion">{options.emotions.map((s) => <option key={s}>{s}</option>)}</S>
      <S k="quality" label="Quality">{["A+", "A", "B", "C"].map((q) => <option key={q}>{q}</option>)}</S>
      <S k="mistake" label="Mistake">{options.mistakes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</S>
      <S k="dow" label="Day">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</S>
      <S k="outcome" label="Outcome"><option value="win">Winners</option><option value="loss">Losers</option></S>
      {showStatus && <S k="status" label="Status"><option value="closed">Closed</option><option value="open">Open</option></S>}
      {v("q") && <span className="inline-flex h-7 items-center gap-1 rounded border border-info/40 bg-info-soft px-2 text-[12px] text-info">“{v("q")}” <button aria-label="Clear search" onClick={() => set("q", "")}><X size={12} /></button></span>}
      {active > 0 && <button onClick={() => router.replace(path, { scroll: false })} className="h-7 px-2 text-[12px] text-muted hover:text-fg">Clear all</button>}
    </div>
  );
}
