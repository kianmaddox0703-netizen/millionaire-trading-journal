export const fmtMoney = (v: number | null | undefined, cur = "USD", signed = false) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return v < 0 ? `−${s}` : signed && v > 0 ? `+${s}` : s;
};
export const fmtMoneyShort = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}$${s}`;
};
export const fmtPct = (v: number | null | undefined, digits = 1, signed = false) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : signed && v > 0 ? "+" : ""}${Math.abs(v).toFixed(digits)}%`;
export const fmtRate = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
export const fmtR = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : v > 0 ? "+" : ""}${Math.abs(v).toFixed(digits)}R`;
export const fmtNum = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v === Infinity ? "∞" : v.toFixed(digits);
export const fmtPrice = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  const d = v >= 1000 ? 2 : v >= 10 ? 3 : 5;
  return v.toFixed(d);
};
export const fmtDate = (d: Date | number | null | undefined, tz: string, withTime = true) => {
  if (d === null || d === undefined) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "short", year: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(d);
};
export const fmtDuration = (from: Date, to: Date | null) => {
  if (!to) return "open";
  const m = Math.round((to.getTime() - from.getTime()) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
};
export const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "text-fg" : v > 0 ? "text-profit" : "text-loss");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
