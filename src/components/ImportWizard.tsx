"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileUp, RefreshCw } from "lucide-react";
import { Badge, Button, Card, Field, Note, Select, Table, th, td, cx } from "@/components/ui";
import { FIELD_LABEL, IMPORT_ZONES, REQUIRED_FIELDS, TARGET_FIELDS, type ColumnMap, type TargetField } from "@/domain/importing";
import { fmtDate, fmtMoney, fmtNum, fmtPrice } from "@/lib/format";

type Decision = "skip" | "merge" | "create";
interface Trade {
  symbol: string; direction: "long" | "short"; status: "open" | "closed"; openedAt: string; closedAt: string | null; entryPrice: number; exitPrice: number | null;
  initialStop: number | null; takeProfit: number | null; sizeLots: number | null; grossPnl: number | null; netPnl: number | null; commission: number | null; swap: number | null; fees: number | null;
  externalRef: string | null; warnings: string[];
}
type Row = { row: number; status: "error"; error: string } | { row: number; status: "new" | "duplicate"; trade: Trade; duplicateOf?: { id: string; seq: number; reason: string } };
interface Preview { kind: string; format: "mt5_report" | "table"; headers: string[]; notices: string[]; mapping: ColumnMap; zone: string; missing: TargetField[]; sample: string[][]; costsHint: boolean | null; rows: Row[] }
interface Summary { created: number; merged: number; skipped: number; failed: { row: number; error: string }[] }

const SHOWN = 300;
const net = (t: Trade) => t.netPnl ?? (t.grossPnl === null ? null : t.grossPnl + (t.commission ?? 0) + (t.swap ?? 0) + (t.fees ?? 0));

export function ImportWizard({ accounts, defaultAccount, tz }: { accounts: { id: string; name: string; currency: string }[]; defaultAccount: string; tz: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState(defaultAccount);
  const [zone, setZone] = useState("AUTO");
  const [dayFirst, setDayFirst] = useState(false);
  const [costsPositive, setCostsPositive] = useState(false);
  const [mapping, setMapping] = useState<ColumnMap | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Summary | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cur = accounts.find((a) => a.id === accountId)?.currency ?? "USD";

  const form = (f: File, extra: Record<string, string>, m: ColumnMap | null, z: string, df: boolean, cp: boolean) => {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("accountId", accountId);
    fd.append("zone", z);
    fd.append("dayFirst", df ? "1" : "0");
    fd.append("costsPositive", cp ? "1" : "0");
    if (m) fd.append("mapping", JSON.stringify(m));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
  };

  async function runPreview(f = file, m = mapping, z = zone, df = dayFirst, cp = costsPositive) {
    if (!f) return;
    setBusy("preview"); setError(""); setResult(null);
    try {
      const res = await fetch("/api/import", { method: "POST", body: form(f, { action: "preview" }, m, z, df, cp) });
      const j = await res.json();
      if (!res.ok) { setPreview(null); setError(j.error ?? "Could not read the file"); return; }
      setPreview(j); setMapping(j.mapping); setZone(j.zone); setDecisions({});
    } catch { setError("Could not reach the server"); } finally { setBusy(""); }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy("commit"); setError("");
    try {
      const res = await fetch("/api/import", { method: "POST", body: form(file, { action: "commit", decisions: JSON.stringify(decisions) }, mapping, zone, dayFirst, costsPositive) });
      const j = await res.json();
      if (!res.ok) { setError(j.error ?? "Import failed"); return; }
      setResult(j); setPreview(null); setFile(null); setMapping(null); setZone("AUTO");
    } catch { setError("Could not reach the server"); } finally { setBusy(""); }
  }

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f); setMapping(null); setZone("AUTO"); setPreview(null);
    runPreview(f, null, "AUTO");
  };

  const counts = useMemo(() => {
    const c = { new: 0, duplicate: 0, error: 0, create: 0, merge: 0 };
    for (const r of preview?.rows ?? []) {
      c[r.status]++;
      if (r.status === "error") continue;
      const d = decisions[r.row] ?? (r.status === "new" ? "create" : "skip");
      if (d === "create") c.create++;
      if (d === "merge") c.merge++;
    }
    return c;
  }, [preview, decisions]);

  const setAllDuplicates = (d: Decision) => setDecisions((prev) => {
    const next = { ...prev };
    for (const r of preview?.rows ?? []) if (r.status === "duplicate") next[r.row] = d === "merge" && r.duplicateOf?.id.startsWith("row:") ? "skip" : d;
    return next;
  });

  return (
    <div className="space-y-3">
      {result && (
        <Note tone={result.failed.length ? "warn" : "profit"}>
          <div className="font-medium">Import finished: {result.created} created, {result.merged} merged into existing trades, {result.skipped} skipped{result.failed.length ? `, ${result.failed.length} rows could not be imported` : ""}.</div>
          {result.failed.length > 0 && <ul className="mt-1 list-disc pl-4">{result.failed.slice(0, 10).map((f) => <li key={f.row}>Row {f.row}: {f.error}</li>)}</ul>}
          <div className="mt-1"><Link className="underline" href="/trades">Open the trade log</Link></div>
        </Note>
      )}

      <Card title="1 · File">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div
            role="button" tabIndex={0} aria-label="Choose a file to import"
            onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
            className={cx("flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded border border-dashed p-4 text-center text-[12px] transition-colors", over ? "border-info bg-info/10" : "border-line-strong hover:bg-surface-2")}
          >
            <FileUp className="h-5 w-5 text-muted" aria-hidden />
            {file ? <span className="font-medium">{file.name}</span> : <span className="font-medium">Drop a file here or click to choose</span>}
            <span className="text-faint">CSV, Excel (.xlsx) or an MT5 trade history report (.html or .xlsx). Up to 10 MB.</span>
            <input ref={input} type="file" className="hidden" accept=".csv,.txt,.xlsx,.htm,.html" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          <div className="space-y-2">
            <Field label="Import into account">
              <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            </Field>
            <Field label="Times in the file are in" hint={zone === "BROKER_NY7" ? "Most MT5 forex brokers. If times look off by an hour, try Europe/Athens." : undefined}>
              <Select value={zone} onChange={(e) => { setZone(e.target.value); runPreview(file, mapping, e.target.value); }}>
                {zone === "AUTO" && <option value="AUTO">Detect from file</option>}
                {IMPORT_ZONES.map((z) => <option key={z.value} value={z.value}>{z.value === "PROFILE" ? `My timezone (${tz})` : z.label}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={dayFirst} onChange={(e) => { setDayFirst(e.target.checked); runPreview(file, mapping, zone, e.target.checked); }} /> Dates are day-first (31/01/2026)</label>
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={costsPositive} onChange={(e) => { setCostsPositive(e.target.checked); runPreview(file, mapping, zone, dayFirst, e.target.checked); }} /> Commission and fees are listed as positive numbers</label>
          </div>
        </div>
        {busy === "preview" && <div className="mt-2 text-[12px] text-muted">Reading the file…</div>}
        {error && <div className="mt-2 text-[12px] text-loss" role="alert">{error}</div>}
      </Card>

      {preview && mapping && (
        <Card title="2 · Columns" action={<Badge tone="info">{preview.format === "mt5_report" ? "MT5 report" : preview.kind.toUpperCase()}</Badge>}>
          {preview.notices.length > 0 && <div className="mb-3 space-y-1">{preview.notices.map((n) => <Note key={n} tone="neutral">{n}</Note>)}</div>}
          {preview.costsHint === true && !costsPositive && <div className="mb-3"><Note tone="warn">Your file's net P&L only adds up if commission is a cost written as a positive number. Tick “Commission and fees are listed as positive numbers”.</Note></div>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {TARGET_FIELDS.map((f) => {
              const required = REQUIRED_FIELDS.includes(f);
              return (
                <Field key={f} label={`${FIELD_LABEL[f]}${required ? " *" : ""}`} error={required && mapping[f] === undefined ? "Required" : undefined}>
                  <Select value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value === "") delete n[f]; else n[f] = Number(e.target.value); return n; })}>
                    <option value="">Not in file</option>
                    {preview.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}{preview.headers.indexOf(h) !== i ? ` (${i + 1})` : ""}</option>)}
                  </Select>
                </Field>
              );
            })}
          </div>
          <div className="mt-3 flex justify-end"><Button size="sm" onClick={() => runPreview()} disabled={busy !== ""}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Update preview</Button></div>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">First rows of the file</div>
          <Table className="mt-1">
            <thead><tr>{preview.headers.map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
            <tbody>{preview.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={cx(td, "whitespace-nowrap")}>{c}</td>)}</tr>)}</tbody>
          </Table>
        </Card>
      )}

      {preview && preview.rows.length > 0 && (
        <Card title="3 · Review" pad={false} action={
          counts.duplicate > 0 && <div className="flex items-center gap-1 text-[11px]"><span className="text-muted">All duplicates:</span>
            <Button size="sm" variant="ghost" onClick={() => setAllDuplicates("skip")}>Ignore</Button>
            <Button size="sm" variant="ghost" onClick={() => setAllDuplicates("merge")}>Merge</Button>
          </div>
        }>
          <div className="flex flex-wrap gap-2 p-3 text-[12px]">
            <Badge tone="profit">{counts.new} new</Badge>
            {counts.duplicate > 0 && <Badge tone="warn">{counts.duplicate} possible duplicates</Badge>}
            {counts.error > 0 && <Badge tone="loss">{counts.error} rows with errors</Badge>}
            <span className="text-muted">Times shown in {tz}.</span>
          </div>
          <Table>
            <thead><tr>{["Row", "Status", "Trade", "Opened → closed", "Entry", "Exit", "Stop", "Size", "Net", "Action"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{preview.rows.slice(0, SHOWN).map((r) => r.status === "error" ? (
              <tr key={r.row}><td className={cx(td, "num text-muted")}>{r.row}</td><td className={td}><Badge tone="loss">Error</Badge></td><td className={cx(td, "text-loss")} colSpan={8}>{r.error}</td></tr>
            ) : (
              <tr key={r.row} className="align-top">
                <td className={cx(td, "num text-muted")}>{r.row}</td>
                <td className={td}>{r.status === "new" ? <Badge tone="profit">New</Badge> : <Badge tone="warn" title={r.duplicateOf?.reason}>Duplicate</Badge>}
                  {r.duplicateOf && <div className="mt-0.5 max-w-[220px] text-[11px] text-faint">{r.duplicateOf.id.startsWith("row:") ? r.duplicateOf.reason : <>Matches <Link className="underline" href={`/trades/${r.duplicateOf.id}`} target="_blank">#{r.duplicateOf.seq}</Link>: {r.duplicateOf.reason}</>}</div>}
                  {r.trade.warnings.map((w) => <div key={w} className="mt-0.5 max-w-[220px] text-[11px] text-warn">{w}</div>)}
                </td>
                <td className={cx(td, "whitespace-nowrap")}>{r.trade.symbol} <span className={r.trade.direction === "long" ? "text-profit" : "text-loss"}>{r.trade.direction === "long" ? "Long" : "Short"}</span>{r.trade.externalRef && <div className="text-[11px] text-faint">#{r.trade.externalRef}</div>}</td>
                <td className={cx(td, "num whitespace-nowrap")}>{fmtDate(new Date(r.trade.openedAt), tz)}<div className="text-muted">{r.trade.closedAt ? `→ ${fmtDate(new Date(r.trade.closedAt), tz)}` : "open"}</div></td>
                <td className={cx(td, "num")}>{fmtPrice(r.trade.entryPrice)}</td>
                <td className={cx(td, "num")}>{fmtPrice(r.trade.exitPrice)}</td>
                <td className={cx(td, "num")}>{fmtPrice(r.trade.initialStop)}</td>
                <td className={cx(td, "num")}>{fmtNum(r.trade.sizeLots)}</td>
                <td className={cx(td, "num")}>{fmtMoney(net(r.trade), cur, true)}</td>
                <td className={td}>
                  {r.status === "new" ? (
                    <Select aria-label={`Action for row ${r.row}`} className="w-[130px] min-w-[130px]" value={decisions[r.row] ?? "create"} onChange={(e) => setDecisions((d) => ({ ...d, [r.row]: e.target.value as Decision }))}>
                      <option value="create">Import</option><option value="skip">Skip</option>
                    </Select>
                  ) : (
                    <Select aria-label={`Action for row ${r.row}`} className="w-[160px] min-w-[160px]" value={decisions[r.row] ?? "skip"} onChange={(e) => setDecisions((d) => ({ ...d, [r.row]: e.target.value as Decision }))}>
                      <option value="skip">Ignore</option>
                      {!r.duplicateOf?.id.startsWith("row:") && <option value="merge">Merge into #{r.duplicateOf?.seq}</option>}
                      <option value="create">Create anyway</option>
                    </Select>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </Table>
          {preview.rows.length > SHOWN && <div className="p-3 text-[12px] text-muted">Showing the first {SHOWN} of {preview.rows.length} rows. Rows not shown use the default action: new rows are imported, duplicates are ignored.</div>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3">
            <span className="text-[12px] text-muted">Merge updates the existing trade's broker data (times, prices, size, P&L, costs) and keeps your notes, psychology, screenshots, strategy and stop.</span>
            <Button variant="primary" onClick={commit} disabled={busy !== "" || counts.create + counts.merge === 0}>
              {busy === "commit" ? "Importing…" : `Import ${counts.create} new${counts.merge ? `, merge ${counts.merge}` : ""}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
