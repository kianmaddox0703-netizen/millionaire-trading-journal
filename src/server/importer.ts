/**
 * File import (CSV, Excel, MT5 trade history report) and the merge logic shared with the MT5 bridge.
 * Stateless: preview and commit both re-parse the uploaded file, so nothing the browser sends back
 * about the parsed trades is trusted.
 */
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/node";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { NotFoundError, getUserTz, refreshRuleMistakes, saveTrade } from "./trades";
import { tradeFormValues } from "./tradeValues";
import { tradeInput } from "@/domain/validation";
import {
  autoMap, decodeText, detectMt5Report, findDuplicate, headerTable, htmlRows, initialStopsFromOrders, rowToTrade,
  REQUIRED_FIELDS, FIELD_LABEL, type ColumnMap, type ExistingTrade, type ImportedTrade,
} from "@/domain/importing";

const T = schema.trades;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export class ImportError extends Error {}

export type FileKind = "csv" | "xlsx" | "html";
export interface ParsedFile {
  kind: FileKind;
  format: "mt5_report" | "table";
  headers: string[];
  rows: unknown[][];
  mapping: ColumnMap;
  stops: Map<string, { sl: number | null; tp: number | null }>;
  notices: string[];
}

async function readRows(buf: Buffer): Promise<{ kind: FileKind; rows: unknown[][] }> {
  if (buf.length > MAX_IMPORT_BYTES) throw new ImportError("File is larger than 10 MB.");
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    try {
      const sheets = await readXlsxFile(buf);
      const first = sheets.find((s) => s.data.length) ?? sheets[0];
      return { kind: "xlsx", rows: (first?.data ?? []) as unknown[][] };
    } catch {
      throw new ImportError("This looks like an Excel file but it could not be read. Save it as .xlsx or CSV and try again.");
    }
  }
  const text = decodeText(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  if (/<table[\s>]/i.test(text.slice(0, 200_000))) return { kind: "html", rows: htmlRows(text) };
  if (text.includes("\u0000")) throw new ImportError("Unsupported file type. Use CSV, Excel (.xlsx) or an MT5 HTML report.");
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return { kind: "csv", rows: res.data };
}

export async function parseFile(buf: Buffer): Promise<ParsedFile> {
  const { kind, rows } = await readRows(buf);
  const mt5 = detectMt5Report(rows);
  const notices: string[] = [];
  let table, format: ParsedFile["format"] = "table", stops = new Map<string, { sl: number | null; tp: number | null }>();
  if (mt5?.positions) {
    table = mt5.positions;
    format = "mt5_report";
    stops = initialStopsFromOrders(mt5.orders);
    notices.push(`MT5 trade history report detected: ${table.rows.length} positions.`);
    if (mt5.orders) notices.push("Initial stops are taken from each position's opening order. Where that order had no stop, the position's final stop is used, so check trades where you moved your stop.");
    else notices.push("The report has no Orders section, so stops are the positions' final stops. Check trades where you moved your stop.");
  } else if (mt5) {
    throw new ImportError("This MT5 report has no Positions table. In MT5 open the History tab, right-click and choose Positions, then right-click again and choose Report.");
  } else {
    table = headerTable(rows);
  }
  if (!table.headers.length || !table.rows.length) throw new ImportError("No rows found in the file.");
  if (table.rows.length > MAX_IMPORT_ROWS) throw new ImportError(`The file has ${table.rows.length} rows; the limit is ${MAX_IMPORT_ROWS} per import. Split it into smaller files.`);
  return { kind, format, headers: table.headers, rows: table.rows, mapping: autoMap(table.headers), stops, notices };
}

// ───────────── preview ─────────────

export interface ImportOptions { accountId: string; mapping: ColumnMap; zone: string; dayFirst: boolean; costsPositive: boolean }

export type PreviewRow =
  | { row: number; status: "error"; error: string }
  | { row: number; status: "new" | "duplicate"; trade: ImportedTrade; duplicateOf?: { id: string; seq: number; ref: string | null; reason: string } };

export function existingForAccount(userId: string, accountId: string): ExistingTrade[] {
  return db.select({ id: T.id, seq: T.seq, symbol: T.symbol, direction: T.direction, openedAt: T.openedAt, entryPrice: T.entryPrice, sizeLots: T.sizeLots, externalRef: T.externalRef })
    .from(T).where(and(eq(T.userId, userId), eq(T.accountId, accountId))).all();
}

function assertAccount(userId: string, accountId: string) {
  if (!db.select({ id: schema.accounts.id }).from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.userId, userId))).get())
    throw new NotFoundError("Account not found");
}

/**
 * Applies the opening-order stop from an MT5 report when it exists and is on the risk side of entry.
 * Costs listed as positive numbers are flipped to the journal's convention (costs are negative).
 */
function finish(t: ImportedTrade, parsed: ParsedFile, costsPositive: boolean): ImportedTrade {
  const out = { ...t, warnings: [...t.warnings] };
  if (parsed.format === "mt5_report" && t.externalRef && parsed.stops.has(t.externalRef)) {
    const st = parsed.stops.get(t.externalRef)!;
    const sign = t.direction === "long" ? 1 : -1;
    if (st.sl !== null && (t.entryPrice - st.sl) * sign > 0) out.initialStop = st.sl;
    else if (st.sl === null && t.initialStop !== null) out.warnings.push("Stop is the position's final stop (the opening order had none)");
    if (st.tp !== null) out.takeProfit = st.tp;
  }
  // swap can be a credit or a charge, so only commission and fees are flipped
  if (costsPositive) for (const k of ["commission", "fees"] as const) if (out[k] !== null) out[k] = -Math.abs(out[k]!);
  return out;
}

/** Evidence from rows that have gross, net and costs: are costs written as positive numbers? */
export function costsLookPositive(trades: ImportedTrade[]): boolean | null {
  let neg = 0, pos = 0;
  for (const t of trades) {
    if (t.grossPnl === null || t.netPnl === null) continue;
    const c = (t.commission ?? 0) + (t.fees ?? 0);
    if (Math.abs(c) < 1e-9) continue;
    const s = t.swap ?? 0;
    if (Math.abs(t.grossPnl + c + s - t.netPnl) < 0.015) neg++;
    else if (Math.abs(t.grossPnl - Math.abs(c) + s - t.netPnl) < 0.015) pos++;
  }
  if (!neg && !pos) return null;
  return pos > neg;
}

export function buildPreview(userId: string, parsed: ParsedFile, o: ImportOptions): PreviewRow[] {
  assertAccount(userId, o.accountId);
  const missing = REQUIRED_FIELDS.filter((f) => o.mapping[f] === undefined);
  if (missing.length) throw new ImportError(`Map these columns first: ${missing.map((f) => FIELD_LABEL[f]).join(", ")}.`);
  const zone = o.zone === "PROFILE" ? getUserTz(userId) : o.zone;
  const existing = existingForAccount(userId, o.accountId);
  const out: PreviewRow[] = [];
  parsed.rows.forEach((cells, i) => {
    const r = rowToTrade(cells, o.mapping, zone, o.dayFirst);
    if (!r.trade) return void out.push({ row: i + 1, status: "error", error: r.error });
    const trade = finish(r.trade, parsed, o.costsPositive);
    const dup = findDuplicate(trade, existing);
    if (dup) out.push({ row: i + 1, status: "duplicate", trade, duplicateOf: { id: dup.trade.id, seq: dup.trade.seq, ref: dup.trade.externalRef, reason: dup.trade.id.startsWith("row:") ? `Repeats ${dup.trade.id.replace("row:", "row ")} of this file` : dup.reason } });
    else {
      out.push({ row: i + 1, status: "new", trade });
      existing.push({ id: `row:${i + 1}`, seq: 0, symbol: trade.symbol, direction: trade.direction, openedAt: trade.openedAt, entryPrice: trade.entryPrice, sizeLots: trade.sizeLots, externalRef: trade.externalRef });
    }
  });
  return out;
}

// ───────────── commit ─────────────

export type Decision = "skip" | "merge" | "create";
export interface ImportSummary { created: number; merged: number; skipped: number; failed: { row: number; error: string }[]; firstOpenedAt: Date | null; tradeIds: string[] }

function strategyLookup(userId: string) {
  const strategies = db.query.strategies.findMany({ where: eq(schema.strategies.userId, userId), with: { setups: true } }).sync();
  return (name: string | null, setup: string | null) => {
    const s = name ? strategies.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    const st = s && setup ? s.setups.find((x) => x.name.trim().toLowerCase() === setup.trim().toLowerCase()) : undefined;
    return { strategyId: s?.id ?? null, setupId: st?.id ?? null };
  };
}

export type Source = "csv" | "mt5_report" | "mt5_bridge";

export function createFromImport(userId: string, accountId: string, t: ImportedTrade, source: Source, ids: { strategyId: string | null; setupId: string | null }) {
  const input = tradeInput.parse({
    accountId, ...ids, symbol: t.symbol, direction: t.direction, status: t.status, openedAt: t.openedAt, closedAt: t.closedAt,
    entryPrice: t.entryPrice, exitPrice: t.exitPrice, initialStop: t.initialStop, takeProfit: t.takeProfit, sizeLots: t.sizeLots,
    grossPnl: t.grossPnl, netPnl: t.netPnl, commission: t.commission, swap: t.swap, fees: t.fees,
    notes: t.notes ? { whatHappened: t.notes } : {},
  });
  return saveTrade(userId, input, undefined, { source, externalRef: t.externalRef, refreshLater: false });
}

/**
 * Merge broker execution data into an existing trade, keeping everything the trader wrote:
 * notes, psychology, emotions, mistakes, checklist, factor ratings, strategy, images and links.
 *   Broker wins: open/close times, entry/exit price, size, P&L, commission, swap, fees, status.
 *   Journal wins: initial stop, take profit and risk amount, when the journal has them (the trader
 *   knows the stop they planned; the broker only knows the last one).
 */
export function mergeIntoTrade(userId: string, tradeId: string, t: ImportedTrade): void {
  const ex = db.select().from(T).where(and(eq(T.id, tradeId), eq(T.userId, userId))).get();
  if (!ex) throw new NotFoundError("Trade not found");
  const v = tradeFormValues(userId, tradeId, "UTC")!;
  const em = db.select().from(schema.psychologyEntries).where(eq(schema.psychologyEntries.tradeId, tradeId)).all();
  const intensity = (p: string) => em.find((e) => e.phase === p)?.intensity ?? null;
  const closed = t.status === "closed" || ex.status === "closed";
  const brokerPnl = t.grossPnl !== null || t.netPnl !== null;
  const input = tradeInput.parse({
    ...v,
    status: closed ? "closed" : "open",
    openedAt: t.openedAt, closedAt: t.closedAt ?? ex.closedAt,
    entryPrice: t.entryPrice, exitPrice: t.exitPrice ?? ex.exitPrice, sizeLots: t.sizeLots ?? ex.sizeLots,
    initialStop: ex.initialStop ?? t.initialStop, takeProfit: ex.takeProfit ?? t.takeProfit, riskAmount: ex.riskAmount,
    grossPnl: brokerPnl ? t.grossPnl : ex.grossPnl, netPnl: brokerPnl ? t.netPnl : ex.netPnl,
    commission: t.commission ?? ex.commission, swap: t.swap ?? ex.swap, fees: t.fees ?? ex.fees,
    emotions: { ...v.emotions, beforeIntensity: intensity("before"), duringIntensity: intensity("during"), afterIntensity: intensity("after") },
  });
  saveTrade(userId, input, tradeId, { refreshLater: false });
  if (t.externalRef && !ex.externalRef) db.update(T).set({ externalRef: t.externalRef }).where(eq(T.id, tradeId)).run();
}

/** Re-runs rule-based mistake detection on trades opened at or after `from` (balances and daily counts shift). */
export function refreshFrom(userId: string, accountId: string, from: Date | null) {
  if (!from) return;
  const ids = db.select({ id: T.id }).from(T).where(and(eq(T.userId, userId), eq(T.accountId, accountId), gt(T.openedAt, new Date(from.getTime() - 1)))).all();
  for (const r of ids) refreshRuleMistakes(userId, r.id);
}

export function commitImport(userId: string, parsed: ParsedFile, o: ImportOptions, decisions: Record<number, Decision>): ImportSummary {
  const preview = buildPreview(userId, parsed, o);
  const lookup = strategyLookup(userId);
  const source: Source = parsed.format === "mt5_report" ? "mt5_report" : "csv";
  const sum: ImportSummary = { created: 0, merged: 0, skipped: 0, failed: [], firstOpenedAt: null, tradeIds: [] };
  const rows = preview.flatMap((p) => (p.status === "error" ? (sum.failed.push({ row: p.row, error: p.error }), []) : [p]));
  rows.sort((a, b) => a.trade.openedAt.getTime() - b.trade.openedAt.getTime());
  for (const p of rows) {
    const d = decisions[p.row] ?? (p.status === "new" ? "create" : "skip");
    const dupInFile = p.duplicateOf?.id.startsWith("row:") ?? false;
    try {
      if (d === "merge" && p.duplicateOf && !dupInFile) { mergeIntoTrade(userId, p.duplicateOf.id, p.trade); sum.merged++; sum.tradeIds.push(p.duplicateOf.id); }
      else if (d === "create") {
        // a broker ID can belong to only one trade per account; "create anyway" keeps the row but not the ID
        const t = p.duplicateOf && p.trade.externalRef && p.trade.externalRef === p.duplicateOf.ref ? { ...p.trade, externalRef: null } : p.trade;
        sum.tradeIds.push(createFromImport(userId, o.accountId, t, source, lookup(t.strategy, t.setup)));
        sum.created++;
      } else { sum.skipped++; continue; }
      if (!sum.firstOpenedAt || p.trade.openedAt < sum.firstOpenedAt) sum.firstOpenedAt = p.trade.openedAt;
    } catch (e) {
      sum.failed.push({ row: p.row, error: e instanceof Error ? e.message : "Could not save" });
    }
  }
  refreshFrom(userId, o.accountId, sum.firstOpenedAt);
  return sum;
}

/** Trades in an account with these broker IDs. */
export function tradesByRef(userId: string, accountId: string, refs: string[]) {
  if (!refs.length) return [];
  return db.select().from(T).where(and(eq(T.userId, userId), eq(T.accountId, accountId), inArray(T.externalRef, refs))).all();
}
