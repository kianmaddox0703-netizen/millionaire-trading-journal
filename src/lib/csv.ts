/** RFC 4180 CSV with spreadsheet formula-injection protection for text cells. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    let s = Array.isArray(v) ? v.join("; ") : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
