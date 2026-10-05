"use client";
import { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const C = { profit: "#2fbf71", loss: "#ef5350", info: "#4c8dff", muted: "#8b94a3", line: "#262c35", warn: "#f0a63a", faint: "#5c6573" };

const tooltipStyle = { background: "#181c22", border: "1px solid #343b46", borderRadius: 4, fontSize: 12, padding: "6px 8px" };
const fmtAxis = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`);

export interface EqPoint { t: number; balance: number; hwm: number; drawdown: number; drawdownPct: number; returnPct: number; cumR: number; rHwm: number; rDrawdown: number }

export function EquityChart({ points, start, height = 260, printWidth }: { points: EqPoint[]; start: number; height?: number; printWidth?: number }) {
  const [mode, setMode] = useState<"$" | "%" | "R">("$");
  const data = [{ t: points[0]?.t ? points[0].t - 1 : 0, balance: start, hwm: start, drawdown: 0, drawdownPct: 0, returnPct: 0, cumR: 0, rHwm: 0, rDrawdown: 0 }, ...points].map((p) => ({
    t: p.t,
    v: mode === "$" ? p.balance : mode === "%" ? p.returnPct : p.cumR,
    hwm: mode === "$" ? p.hwm : mode === "%" ? (start > 0 ? ((p.hwm - start) / start) * 100 : 0) : p.rHwm,
    dd: mode === "$" ? -p.drawdown : mode === "%" ? -p.drawdownPct : -p.rDrawdown,
  }));
  const unit = (v: number) => (mode === "$" ? `$${v.toFixed(2)}` : mode === "%" ? `${v.toFixed(2)}%` : `${v.toFixed(2)}R`);
  const chart = (size: { width?: number; height?: number }) => (
    <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} {...size}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} tickLine={false} axisLine={false} minTickGap={40} />
      <YAxis yAxisId="v" tickFormatter={fmtAxis} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
      <YAxis yAxisId="dd" orientation="right" hide domain={([min]: readonly [number, number]) => [Math.min(min * 3, -1), 0] as const} />
      <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-GB")} formatter={(v, k) => [unit(Number(v)), k === "v" ? (mode === "R" ? "Cum. R" : mode === "%" ? "Return" : "Balance") : k === "hwm" ? "High-water" : "Drawdown"]} />
      <Area yAxisId="dd" dataKey="dd" type="stepAfter" fill={C.loss} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
      <Line yAxisId="v" dataKey="hwm" type="stepAfter" stroke={C.muted} strokeDasharray="3 3" dot={false} strokeWidth={1} isAnimationActive={false} />
      <Line yAxisId="v" dataKey="v" type="linear" stroke={C.info} dot={false} strokeWidth={1.75} isAnimationActive={false} />
    </ComposedChart>
  );
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 bg-info" /> {mode === "$" ? "Balance" : mode === "%" ? "Return" : "Cumulative R"}</span>
          <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 border-t border-dashed border-muted" /> High-water mark</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 bg-loss/30" /> Drawdown</span>
        </div>
        <div className="flex rounded border border-line p-px print:hidden" role="group" aria-label="Units">
          {(["$", "%", "R"] as const).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={`h-6 w-7 rounded-sm text-[11px] ${mode === m ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}>{m}</button>
          ))}
        </div>
      </div>
      {/* Screen: responsive. Print: fixed width, because the page is re-laid out for paper without a resize. */}
      <div className={printWidth ? "print:hidden" : undefined}><ResponsiveContainer width="100%" height={height}>{chart({})}</ResponsiveContainer></div>
      {printWidth && <div className="hidden print:block">{chart({ width: printWidth, height })}</div>}
    </div>
  );
}

export function PnlBars({ data, height = 200, unit = "$", horizontal = false }: { data: { label: string; value: number; n?: number }[]; height?: number; unit?: "$" | "R"; horizontal?: boolean }) {
  const f = (v: number) => (unit === "$" ? `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}` : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}R`);
  if (!data.length) return <div className="grid place-items-center text-[12px] text-faint" style={{ height }}>No data</div>;
  return (
    <ResponsiveContainer width="100%" height={horizontal ? Math.max(height, data.length * 26 + 20) : height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={fmtAxis} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} interval={0} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickFormatter={fmtAxis} tickLine={false} axisLine={false} width={44} />
          </>
        )}
        <ReferenceLine {...(horizontal ? { x: 0 } : { y: 0 })} stroke={C.faint} />
        <Tooltip cursor={{ fill: "#ffffff08" }} contentStyle={tooltipStyle} formatter={(v, _k, item) => [`${f(Number(v))}${item?.payload?.n !== undefined ? `  ·  n=${item.payload.n}` : ""}`, unit === "$" ? "Net P&L" : "R"]} />
        <Bar dataKey="value" maxBarSize={28} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? C.profit : C.loss} fillOpacity={0.85} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Histogram({ data, height = 200 }: { data: { label: string; count: number; positive: boolean | null }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} fontSize={10} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
        <Tooltip cursor={{ fill: "#ffffff08" }} contentStyle={tooltipStyle} formatter={(v) => [String(v), "Trades"]} />
        <Bar dataKey="count" isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.positive === null ? C.muted : d.positive ? C.profit : C.loss} fillOpacity={0.8} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  const up = (values.at(-1) ?? 0) >= (values[0] ?? 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Area dataKey="v" stroke={up ? C.profit : C.loss} fill={up ? C.profit : C.loss} fillOpacity={0.1} strokeWidth={1.25} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
