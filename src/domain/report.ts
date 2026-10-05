import { weekStartOf } from "./sessions";

export interface ReportTrade {
  netPnl: number | null;
  rMultiple: number | null;
  day: string; // YYYY-MM-DD
}

export function sumBy<T extends ReportTrade>(trades: T[], key: (t: T) => string | null | undefined, metric: "pnl" | "r" = "pnl") {
  const m = new Map<string, { value: number; n: number }>();
  for (const t of trades) {
    if (t.netPnl === null) continue;
    const k = key(t);
    if (!k) continue;
    const e = m.get(k) ?? { value: 0, n: 0 };
    e.value += metric === "pnl" ? t.netPnl : t.rMultiple ?? 0;
    e.n += 1;
    m.set(k, e);
  }
  return [...m.entries()].map(([label, e]) => ({ label, value: e.value, n: e.n }));
}

export const dailyPnl = (ts: ReportTrade[]) => sumBy(ts, (t) => t.day).sort((a, b) => a.label.localeCompare(b.label));
export const weeklyPnl = (ts: ReportTrade[]) =>
  sumBy(ts, (t) => weekStartOf(t.day)).sort((a, b) => a.label.localeCompare(b.label)).map((w) => ({ ...w, label: w.label.slice(5) }));

const BIN = 0.5;
/** R-multiple histogram with 0.5R bins, clamped at −3R and +5R. */
export function rHistogram(ts: ReportTrade[]) {
  const lo = -3, hi = 5;
  const bins: { label: string; count: number; positive: boolean | null; from: number }[] = [];
  for (let x = lo; x < hi; x += BIN) bins.push({ from: x, label: `${x >= 0 ? "+" : ""}${x}`, count: 0, positive: x >= 0 ? (x === 0 ? null : true) : false });
  for (const t of ts) {
    if (t.rMultiple === null) continue;
    const r = Math.max(lo, Math.min(hi - 1e-9, t.rMultiple));
    const i = Math.floor((r - lo) / BIN);
    bins[i].count++;
  }
  for (const b of bins) b.positive = b.from >= 0 ? true : false;
  bins[0].label = `≤${lo}`;
  bins[bins.length - 1].label = `≥${hi - BIN}`;
  return bins;
}

export function winLossDistribution(ts: ReportTrade[]) {
  let w = 0, l = 0, b = 0;
  for (const t of ts) {
    if (t.netPnl === null) continue;
    if (t.netPnl > 0) w++;
    else if (t.netPnl < 0) l++;
    else b++;
  }
  return { wins: w, losses: l, breakeven: b };
}

export const sortByOrder = <T extends { label: string }>(xs: T[], order: readonly string[]) =>
  [...xs].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
