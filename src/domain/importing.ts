/**
 * Import helpers: symbol normalisation, column auto-mapping, timezone-aware value parsing,
 * MT5 report detection, MT5 deal aggregation and duplicate detection.
 * Pure functions, unit-tested in tests/importing.test.ts.
 */

// ───────────── symbols ─────────────

/** "OANDA:EURUSD", "EURUSD.raw", "EURUSDm", "eur/usd", "FX:EURUSD" → "EURUSD". Other symbols keep their core. */
export function normalizeSymbol(raw: string): string {
  let s = raw.trim().toUpperCase();
  if (s.includes(":")) s = s.split(":").pop()!;
  s = s.replace(/[/\s]/g, "");
  // 6-letter FX pairs / metals with a broker suffix: EURUSD.r, EURUSD-ECN, XAUUSD#, EURUSD_i
  let m = /^([A-Z]{6})[.#!_+-][A-Z0-9]{0,6}$/.exec(s);
  if (m) return m[1];
  // glued suffixes: EURUSDm, XAUUSDc, EURUSDpro
  m = /^([A-Z]{6})(M|C|I|Z|PRO|ECN|RAW|MICRO)$/.exec(s);
  if (m) return m[1];
  return s.replace(/[#!+]+$/, "");
}

// ───────────── timezones ─────────────

/**
 * Timezones that imported wall-clock times can be in.
 *   BROKER_NY7: most MT5 forex servers run on "New York close" time, i.e. New York time + 7h
 *               (UTC+2 in winter, UTC+3 in summer, switching on US DST dates).
 *   PROFILE:    the user's own timezone from Settings (resolved by the caller).
 *   anything else: an IANA zone such as "UTC" or "Europe/Athens".
 */
export const IMPORT_ZONES = [
  { value: "BROKER_NY7", label: "MT5 server time, New York close (UTC+2, UTC+3 in summer)" },
  { value: "UTC", label: "UTC" },
  { value: "PROFILE", label: "My timezone (from Settings)" },
  { value: "Europe/Athens", label: "Europe/Athens (EET with EU daylight saving)" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "America/New_York", label: "America/New_York" },
] as const;

function zoneOffsetMs(utcMs: number, zone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** `wall` is Date.UTC(...) of the wall-clock fields; returns the real instant for a wall clock in `zone`. */
export function wallClockToUtc(wall: number, zone: string): Date {
  if (zone === "UTC") return new Date(wall);
  if (zone === "BROKER_NY7") return wallClockToUtc(wall - 7 * 3600_000, "America/New_York");
  let guess = wall - zoneOffsetMs(wall, zone);
  guess = wall - zoneOffsetMs(guess, zone); // second pass settles DST boundaries
  return new Date(guess);
}

// ───────────── column mapping ─────────────

export const TARGET_FIELDS = [
  "symbol", "direction", "openedAt", "closedAt", "entryPrice", "exitPrice", "initialStop", "takeProfit",
  "sizeLots", "grossPnl", "netPnl", "commission", "swap", "fees", "externalRef", "strategy", "setup", "notes",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];
export type ColumnMap = Partial<Record<TargetField, number>>;

export const FIELD_LABEL: Record<TargetField, string> = {
  symbol: "Symbol", direction: "Direction (buy/sell)", openedAt: "Open time", closedAt: "Close time", entryPrice: "Entry price",
  exitPrice: "Exit price", initialStop: "Stop loss", takeProfit: "Take profit", sizeLots: "Volume / lots", grossPnl: "Profit (before costs)",
  netPnl: "Net P&L (after costs)", commission: "Commission", swap: "Swap", fees: "Other fees", externalRef: "Ticket / position ID", strategy: "Strategy", setup: "Setup", notes: "Notes",
};
export const REQUIRED_FIELDS: TargetField[] = ["symbol", "direction", "openedAt", "entryPrice"];

const SYNONYMS: Record<TargetField, string[]> = {
  symbol: ["symbol", "instrument", "pair", "ticker", "market", "item", "asset"],
  direction: ["type", "direction", "side", "action", "buy/sell", "b/s", "position type", "trade type"],
  openedAt: ["open time", "opentime", "time open", "entry time", "open date", "date open", "opened", "opening time", "open", "time", "date"],
  closedAt: ["close time", "closetime", "time close", "exit time", "close date", "closed", "closing time"],
  entryPrice: ["open price", "entry price", "price open", "openprice", "opening price", "entry", "price"],
  exitPrice: ["close price", "exit price", "price close", "closeprice", "closing price", "exit"],
  initialStop: ["s / l", "s/l", "sl", "stop loss", "stoploss", "stop"],
  takeProfit: ["t / p", "t/p", "tp", "take profit", "takeprofit", "target"],
  sizeLots: ["volume", "lots", "size", "lot", "quantity", "qty", "amount"],
  grossPnl: ["profit", "gross profit", "gross p&l", "gross pnl", "p/l", "pl"],
  netPnl: ["net profit", "net p&l", "net pnl", "net", "pnl", "p&l", "result"],
  commission: ["commission", "commissions", "comm"],
  swap: ["swap", "swaps", "rollover", "financing"],
  fees: ["fee", "fees"],
  externalRef: ["position", "position id", "ticket", "order", "deal", "trade id", "id", "trade #", "#"],
  strategy: ["strategy"],
  setup: ["setup"],
  notes: ["comment", "comments", "notes", "note"],
};

const normHeader = (h: unknown) => String(h ?? "").toLowerCase().replace(/[ _]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Best-guess mapping from headers to trade fields: exact synonym matches first, then
 * "contains" matches. Repeated "Time"/"Price" headers (MT5 Positions table) map in
 * order: first → open, second → close.
 */
export function autoMap(headers: unknown[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  const H = headers.map(normHeader);
  const repeated = (name: string) => H.map((h, i) => (h === name ? i : -1)).filter((i) => i >= 0);
  const [t1, t2] = repeated("time");
  const [p1, p2] = repeated("price");
  if (t2 !== undefined) { map.openedAt = t1; map.closedAt = t2; used.add(t1).add(t2); }
  if (p2 !== undefined) { map.entryPrice = p1; map.exitPrice = p2; used.add(p1).add(p2); }
  for (const pass of ["exact", "contains"] as const) {
    for (const f of TARGET_FIELDS) {
      if (map[f] !== undefined) continue;
      for (const syn of SYNONYMS[f]) {
        const i = H.findIndex((h, idx) => !used.has(idx) && (pass === "exact" ? h === syn : syn.length > 3 && h.includes(syn)));
        if (i >= 0) { map[f] = i; used.add(i); break; }
      }
    }
  }
  return map;
}

// ───────────── values ─────────────

/** "1 234.56", "1,234.56", "-12.3", "(12.30)", "1.234,56", "0.10 / 0.10" (MT5 volume / filled) → number. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || typeof v === "boolean") return null;
  let s = String(v).split(" / ")[0].trim().replace(/[\s $€£]/g, "");
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/**
 * Dates: ISO with zone (taken as-is), "2026.03.04 09:15:22" (MT5), "2026-03-04 09:15", "04/03/2026 09:15",
 * Excel serial numbers and spreadsheet Date cells. Times without a zone are wall-clock times in `zone`.
 * For "dd/mm/yyyy" vs "mm/dd/yyyy" the order is inferred when a part is > 12, otherwise `dayFirst` decides.
 */
export function parseDate(v: unknown, zone = "UTC", dayFirst = false): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : wallClockToUtc(v.getTime(), zone); // spreadsheet cells carry wall clock in UTC fields
  if (typeof v === "number") return v > 20000 && v < 80000 ? wallClockToUtc(Math.round((v - 25569) * 86400_000), zone) : null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(s) && !Number.isNaN(Date.parse(s))) return new Date(s);
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    y = +m[3];
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else if (dayFirst) { d = a; mo = b; } else { mo = a; d = b; }
  }
  const [hh, mi, ss] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  return wallClockToUtc(Date.UTC(y, mo - 1, d, hh, mi, ss), zone);
}

export function parseDirection(v: unknown): "long" | "short" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (/^(buy|long|b$|bull)/.test(s)) return "long";
  if (/^(sell|short|s$|bear)/.test(s)) return "short";
  return null;
}

export interface ImportedTrade {
  symbol: string;
  direction: "long" | "short";
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  entryPrice: number;
  exitPrice: number | null;
  initialStop: number | null;
  takeProfit: number | null;
  sizeLots: number | null;
  grossPnl: number | null;
  netPnl: number | null;
  commission: number | null;
  swap: number | null;
  fees: number | null;
  externalRef: string | null;
  strategy: string | null;
  setup: string | null;
  notes: string | null;
  warnings: string[];
}

export type RowResult = { trade: ImportedTrade; error?: undefined } | { trade?: undefined; error: string };

/**
 * One row → trade. A trade is closed when it has a close time and an exit price or P&L.
 * Stops on the wrong side of entry (moved to breakeven or into profit before the export) cannot be
 * the initial risk, so they are dropped with a warning rather than producing a wrong R.
 */
export function rowToTrade(cells: unknown[], map: ColumnMap, zone = "UTC", dayFirst = false): RowResult {
  const get = (f: TargetField) => (map[f] === undefined ? undefined : cells[map[f]!]);
  const str = (f: TargetField) => { const v = get(f); return v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim(); };
  const symbol = str("symbol") ? normalizeSymbol(str("symbol")!) : "";
  if (!symbol) return { error: "Missing symbol" };
  const direction = parseDirection(get("direction"));
  if (!direction) return { error: `Direction “${str("direction") ?? ""}” is not buy/sell/long/short` };
  const openedAt = parseDate(get("openedAt"), zone, dayFirst);
  if (!openedAt) return { error: `Open time “${str("openedAt") ?? ""}” is not a date` };
  const entryPrice = parseNumber(get("entryPrice"));
  if (entryPrice === null || entryPrice <= 0) return { error: "Missing entry price" };
  const closedAt = parseDate(get("closedAt"), zone, dayFirst);
  if (closedAt && closedAt < openedAt) return { error: "Close time is before open time" };
  const pos = (f: TargetField) => { const n = parseNumber(get(f)); return n !== null && n > 0 ? n : null; };
  const exitPrice = pos("exitPrice");
  const grossPnl = parseNumber(get("grossPnl")), netPnl = parseNumber(get("netPnl"));
  const warnings: string[] = [];
  let initialStop = pos("initialStop");
  const sign = direction === "long" ? 1 : -1;
  if (initialStop !== null && (initialStop - entryPrice) * sign >= 0) {
    warnings.push(`Stop ${initialStop} is at or beyond entry, so it was moved before export; initial stop left empty`);
    initialStop = null;
  }
  const closed = !!closedAt && (exitPrice !== null || grossPnl !== null || netPnl !== null);
  return {
    trade: {
      symbol, direction, status: closed ? "closed" : "open", openedAt, closedAt: closed ? closedAt : null, entryPrice,
      exitPrice: closed ? exitPrice : null, initialStop, takeProfit: pos("takeProfit"), sizeLots: pos("sizeLots"),
      grossPnl, netPnl, commission: parseNumber(get("commission")), swap: parseNumber(get("swap")), fees: parseNumber(get("fees")),
      externalRef: str("externalRef"), strategy: str("strategy"), setup: str("setup"), notes: str("notes"), warnings,
    },
  };
}

// ───────────── files → rows ─────────────

/** Decodes bytes honouring UTF-8/UTF-16 BOMs (MT5 HTML reports are UTF-16LE) and BOM-less UTF-16. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  const sample = bytes.subarray(0, 400);
  let oddNulls = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) oddNulls++;
  if (sample.length > 20 && oddNulls > sample.length / 4) return new TextDecoder("utf-16le").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? all);

/**
 * Table rows from HTML as arrays of cell text (td and th). Cells marked class="hidden"
 * (MT5 reports use them as layout spacers) are skipped. Nothing is executed or rendered.
 */
export function htmlRows(html: string): string[][] {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const rows: string[][] = [];
  for (const tr of body.split(/<tr\b/i).slice(1)) {
    const end = tr.search(/<\/tr>/i);
    const chunk = end >= 0 ? tr.slice(0, end) : tr;
    const cells: string[] = [];
    const re = /<(td|th)\b([^>]*)>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      if (/class\s*=\s*["']?[^"'>]*\bhidden\b/i.test(m[2])) continue;
      cells.push(decodeEntities(m[3].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim());
    }
    rows.push(cells);
  }
  return rows;
}

export interface TableData { headers: string[]; rows: unknown[][] }

/** First non-empty row is the header; fully blank rows are dropped. */
export function headerTable(all: unknown[][]): TableData {
  const nonEmpty = all.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
  const [h = [], ...rows] = nonEmpty;
  return { headers: h.map((c) => String(c ?? "").trim()), rows };
}

// ───────────── MT5 trade history report ─────────────

export interface Mt5Report { positions: TableData | null; orders: TableData | null; hasDeals: boolean }

const SECTION_NAMES = ["positions", "orders", "deals", "open positions", "working orders", "summary", "results"];

/**
 * Finds the sections of an MT5 "Trade History Report" (HTML or Open XML) in raw rows:
 * a row whose only non-empty cell is a section title ("Positions", "Orders", "Deals"…),
 * followed by its header row and data rows until the next section or a blank row.
 * Returns null when the rows don't look like an MT5 report.
 */
export function detectMt5Report(all: unknown[][]): Mt5Report | null {
  const text = (r: unknown[]) => r.map((c) => String(c ?? "").trim()).filter(Boolean);
  const sections: Record<string, TableData> = {};
  for (let i = 0; i < all.length; i++) {
    const t = text(all[i]);
    if (t.length !== 1 || !SECTION_NAMES.includes(t[0].toLowerCase())) continue;
    const name = t[0].toLowerCase();
    const header = all[i + 1]?.map((c) => String(c ?? "").trim()) ?? [];
    const rows: unknown[][] = [];
    for (let j = i + 2; j < all.length; j++) {
      const tj = text(all[j]);
      if (!tj.length || (tj.length === 1 && SECTION_NAMES.includes(tj[0].toLowerCase()))) break;
      rows.push(all[j]);
    }
    sections[name] ??= { headers: header, rows };
  }
  if (!sections.positions && !sections.deals) return null;
  const valid = (s?: TableData) => (s && s.headers.some((h) => /symbol/i.test(h)) ? s : null);
  return { positions: valid(sections.positions), orders: valid(sections.orders), hasDeals: !!sections.deals };
}

/**
 * Initial stops from the Orders section: in MT5 the position ID equals the ticket of the order that
 * opened it, so that order's S / L and T / P are the stops set when the trade was placed.
 */
export function initialStopsFromOrders(orders: TableData | null): Map<string, { sl: number | null; tp: number | null }> {
  const out = new Map<string, { sl: number | null; tp: number | null }>();
  if (!orders) return out;
  const H = orders.headers.map(normHeader);
  const iOrder = H.indexOf("order"), iSl = H.findIndex((h) => h === "s / l" || h === "sl"), iTp = H.findIndex((h) => h === "t / p" || h === "tp");
  if (iOrder < 0) return out;
  for (const r of orders.rows) {
    const id = String(r[iOrder] ?? "").trim();
    if (!id) continue;
    const sl = iSl >= 0 ? parseNumber(r[iSl]) : null, tp = iTp >= 0 ? parseNumber(r[iTp]) : null;
    out.set(id, { sl: sl && sl > 0 ? sl : null, tp: tp && tp > 0 ? tp : null });
  }
  return out;
}

// ───────────── MT5 deals (bridge) → trades ─────────────

export interface Mt5Deal {
  ticket: string;
  orderId?: string | null;
  positionId: string;
  time: Date;
  type: string; // "buy" | "sell"; balance/credit/etc. deals are ignored
  entry: string; // "in" | "out" | "inout" | "out_by"
  symbol: string;
  volume: number;
  price: number;
  sl?: number | null;
  tp?: number | null;
  commission: number;
  swap: number;
  profit: number;
  comment?: string | null;
}

/**
 * Groups deals by position into round trips.
 *   direction  = type of the first entry deal (buy → long)
 *   entry      = volume-weighted price of entry deals
 *   exit       = volume-weighted price of exit deals
 *   gross P&L  = Σ profit;  commission = Σ commission (incl. fees);  swap = Σ swap
 *   closed     = exit volume ≥ entry volume
 *   initial SL = opening order's SL (`stops`), else the first entry deal's SL
 * A reversal deal ("inout") closes the old position; MT5 gives the new one its own position ID.
 */
export function aggregateMt5(deals: Mt5Deal[], stops: Map<string, { sl: number | null; tp: number | null }> = new Map()): ImportedTrade[] {
  const byPos = new Map<string, Mt5Deal[]>();
  for (const d of deals) {
    if (d.type !== "buy" && d.type !== "sell") continue;
    byPos.set(d.positionId, [...(byPos.get(d.positionId) ?? []), d]);
  }
  const out: ImportedTrade[] = [];
  for (const [pos, ds] of byPos) {
    ds.sort((a, b) => a.time.getTime() - b.time.getTime());
    const ins = ds.filter((d) => d.entry === "in");
    const outs = ds.filter((d) => d.entry === "out" || d.entry === "out_by" || d.entry === "inout");
    if (!ins.length) continue; // opened before the synced window; skipped until its entry deal is seen
    const vin = ins.reduce((a, d) => a + d.volume, 0), vout = outs.reduce((a, d) => a + d.volume, 0);
    const vwap = (xs: Mt5Deal[], v: number) => xs.reduce((a, d) => a + d.price * d.volume, 0) / v;
    const closed = vout > 0 && vout + 1e-9 >= vin;
    const direction = ins[0].type === "buy" ? "long" : "short";
    const entryPrice = vwap(ins, vin);
    const st = stops.get(pos);
    let initialStop = st?.sl ?? (ins[0].sl || null);
    const warnings: string[] = [];
    if (initialStop !== null && (initialStop - entryPrice) * (direction === "long" ? 1 : -1) >= 0) {
      warnings.push("Stop on the opening order is at or beyond entry; initial stop left empty");
      initialStop = null;
    }
    out.push({
      symbol: normalizeSymbol(ins[0].symbol), direction, status: closed ? "closed" : "open",
      openedAt: ins[0].time, closedAt: closed ? outs[outs.length - 1].time : null,
      entryPrice, exitPrice: closed ? vwap(outs, vout) : null,
      initialStop, takeProfit: st?.tp ?? (ins[0].tp || null), sizeLots: Math.round(vin * 1e6) / 1e6,
      grossPnl: closed ? ds.reduce((a, d) => a + d.profit, 0) : null, netPnl: null,
      commission: ds.reduce((a, d) => a + d.commission, 0), swap: ds.reduce((a, d) => a + d.swap, 0), fees: null,
      externalRef: pos, strategy: null, setup: null, notes: ins[0].comment || null, warnings,
    });
  }
  return out.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
}

// ───────────── duplicate detection ─────────────

export interface ExistingTrade { id: string; seq: number; symbol: string; direction: "long" | "short"; openedAt: Date; entryPrice: number; sizeLots: number | null; externalRef: string | null }

/**
 * An imported trade duplicates an existing trade in the same account when:
 *  - the broker ID (ticket / position) is equal, or
 *  - neither has a different broker ID, symbol and direction match, open times are within 2 minutes,
 *    entry prices within 0.05%, and sizes match when both are known
 *    (catches trades journaled by hand before importing).
 */
export function findDuplicate(t: Pick<ImportedTrade, "symbol" | "direction" | "openedAt" | "entryPrice" | "sizeLots" | "externalRef">, existing: ExistingTrade[]): { trade: ExistingTrade; reason: string } | null {
  if (t.externalRef) {
    const e = existing.find((x) => x.externalRef === t.externalRef);
    if (e) return { trade: e, reason: `Same broker ID ${t.externalRef}` };
  }
  for (const e of existing) {
    if (t.externalRef && e.externalRef) continue; // both have broker IDs and they differ
    if (normalizeSymbol(e.symbol) !== t.symbol || e.direction !== t.direction) continue;
    if (Math.abs(e.openedAt.getTime() - t.openedAt.getTime()) > 120_000) continue;
    if (Math.abs(e.entryPrice - t.entryPrice) / t.entryPrice > 0.0005) continue;
    if (e.sizeLots !== null && t.sizeLots !== null && Math.abs(e.sizeLots - t.sizeLots) > 1e-6) continue;
    return { trade: e, reason: "Same symbol, direction, open time (±2 min), entry price and size" };
  }
  return null;
}
