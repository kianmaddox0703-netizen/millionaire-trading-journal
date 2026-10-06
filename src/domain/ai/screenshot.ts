/**
 * Screenshot reading: output schemas and pure helpers (no server imports; the trade form uses them too).
 *
 * The model reports what it reads from the pixels, tagged observed / inferred / unknown. Everything that
 * can be checked with arithmetic (risk/reward, record mismatches, overall strategy fit) is computed here
 * from those readings instead of being taken from the model.
 */
import { z } from "zod";
import { normalizeSymbol } from "@/domain/importing";

export const READING_STATUS = ["observed", "inferred", "unknown"] as const;
export type ReadingStatus = (typeof READING_STATUS)[number];
export const CHART_SOURCES = ["tradingview", "mt5", "other", "not_a_chart"] as const;
export const STRUCTURE_ASPECTS = ["trend", "market_structure", "support_resistance", "liquidity", "entry_location", "other"] as const;
export const RULE_STATUS = ["met", "not_met", "not_visible"] as const;
export const FIT = ["consistent", "partly", "inconsistent", "cannot_tell", "no_required"] as const;
export const FIELD_KEYS = ["symbol", "timeframe", "direction", "entry", "stop", "takeProfit"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

// Every schema node is built fresh (no shared instances) so the JSON schema sent to the API has no $refs.
const statusEnum = () => z.enum(READING_STATUS).describe("observed: printed/drawn and legible; inferred: likely but not printed; unknown: not determinable (value null)");
const reading = <T extends z.ZodType>(value: () => T, what: string) =>
  z.object({ value: value(), status: statusEnum(), evidence: z.string().describe(`Where in the image the ${what} comes from, or why it is unknown`) });
const fieldsSchema = () => z.object({
  symbol: reading(() => z.string().nullable(), "symbol"),
  timeframe: reading(() => z.string().nullable(), "timeframe"),
  direction: reading(() => z.enum(["long", "short"]).nullable(), "direction"),
  entry: reading(() => z.number().nullable(), "entry price"),
  stop: reading(() => z.number().nullable(), "stop-loss price"),
  takeProfit: reading(() => z.number().nullable(), "take-profit price"),
});

/** Structured output for quick entry: the six readings only. */
export const ExtractModelOutput = z.object({
  chartSource: z.enum(CHART_SOURCES),
  fields: fieldsSchema(),
  unknown: z.array(z.string()),
});

/** Structured output for a stored trade screenshot. */
export const AnalysisModelOutput = z.object({
  chartSource: z.enum(CHART_SOURCES),
  fields: fieldsSchema(),
  observed: z.array(z.string()),
  inferred: z.array(z.string()),
  unknown: z.array(z.string()),
  structure: z.array(z.object({ aspect: z.enum(STRUCTURE_ASPECTS), note: z.string(), basis: z.enum(["observed", "inferred"]) })),
  strategyRules: z.array(z.object({ id: z.string(), status: z.enum(RULE_STATUS), evidence: z.string() })),
  strategySummary: z.string(),
  discrepancies: z.array(z.object({ topic: z.string(), chart: z.string(), record: z.string(), basis: z.enum(["observed", "inferred"]) })),
  summary: z.string(),
});
export type AnalysisModelOutput = z.infer<typeof AnalysisModelOutput>;
export type ExtractModelOutput = z.infer<typeof ExtractModelOutput>;
export type Fields = ExtractModelOutput["fields"];

// ───────────── stored shapes (validated when read back) ─────────────

const storedReading = <T extends z.ZodType>(v: T) => z.object({ value: v, status: z.enum(READING_STATUS), evidence: z.string() });
const StoredFields = z.object({
  symbol: storedReading(z.string().nullable()), timeframe: storedReading(z.string().nullable()), direction: storedReading(z.enum(["long", "short"]).nullable()),
  entry: storedReading(z.number().nullable()), stop: storedReading(z.number().nullable()), takeProfit: storedReading(z.number().nullable()),
});

export const ScreenshotExtract = z.object({ chartSource: z.enum(CHART_SOURCES), fields: StoredFields, unknown: z.array(z.string()) });
export type ScreenshotExtract = z.infer<typeof ScreenshotExtract>;

export const ScreenshotAnalysis = z.object({
  chartSource: z.enum(CHART_SOURCES),
  fields: StoredFields,
  observed: z.array(z.string()),
  inferred: z.array(z.string()),
  unknown: z.array(z.string()),
  structure: z.array(z.object({ aspect: z.enum(STRUCTURE_ASPECTS), note: z.string(), basis: z.enum(["observed", "inferred"]) })),
  riskReward: z.object({ value: z.number().nullable(), basis: z.enum(["computed_from_visible_levels", "unknown"]), note: z.string() }),
  strategyFit: z.object({
    strategy: z.string().nullable(),
    overall: z.enum(FIT),
    rules: z.array(z.object({ rule: z.string(), kind: z.string(), required: z.boolean(), status: z.enum(RULE_STATUS), evidence: z.string() })),
    summary: z.string(),
  }),
  discrepancies: z.array(z.object({ topic: z.string(), chart: z.string(), record: z.string(), basis: z.enum(["observed", "inferred"]), source: z.enum(["app", "ai"]) })),
  summary: z.string(),
  image: z.object({ width: z.number(), height: z.number(), sentWidth: z.number(), sentHeight: z.number() }),
  promptVersion: z.string(),
});
export type ScreenshotAnalysis = z.infer<typeof ScreenshotAnalysis>;

// ───────────── labels ─────────────

export const STATUS_LABEL: Record<ReadingStatus, string> = { observed: "Observed", inferred: "Inferred", unknown: "Unknown" };
export const STATUS_HELP: Record<ReadingStatus, string> = {
  observed: "Printed or drawn in the screenshot and legible.",
  inferred: "A likely reading that isn't printed in the screenshot.",
  unknown: "The screenshot doesn't show it.",
};
export const FIELD_LABEL: Record<FieldKey, string> = { symbol: "Symbol", timeframe: "Timeframe", direction: "Direction", entry: "Entry", stop: "Stop loss", takeProfit: "Take profit" };
export const SOURCE_LABEL: Record<(typeof CHART_SOURCES)[number], string> = { tradingview: "TradingView", mt5: "MetaTrader 5", other: "Other chart", not_a_chart: "Not a chart" };
export const ASPECT_LABEL: Record<(typeof STRUCTURE_ASPECTS)[number], string> = {
  trend: "Trend", market_structure: "Market structure", support_resistance: "Support / resistance", liquidity: "Liquidity", entry_location: "Entry location", other: "Other",
};
export const FIT_LABEL: Record<(typeof FIT)[number], string> = {
  consistent: "Consistent with your required rules, as far as the image shows",
  partly: "Partly consistent: some required rules can't be confirmed from the image",
  inconsistent: "Inconsistent: a required rule is not met",
  cannot_tell: "Can't tell from this image",
  no_required: "No required rules to judge by; see each rule below",
};

// ───────────── Claude vision sizing (platform.claude.com/docs/en/build-with-claude/vision-coordinates) ─────────────

export const VISION_TIERS = { high: { maxEdge: 2576, maxTokens: 4784 }, standard: { maxEdge: 1568, maxTokens: 1568 } } as const;
/** API limit per image: 10 MB base64-encoded (decimal reading, to stay on the safe side). */
export const MAX_IMAGE_BASE64_CHARS = 10_000_000;

/** High-resolution tier is Claude 4.7 and later; older ids get the standard tier. Unknown ids get high (the API downsizes further if needed). */
export function visionTier(model: string): keyof typeof VISION_TIERS {
  const m = model.toLowerCase().replace(/^.*?anthropic\./, "").replace(/@.*$/, "");
  if (/^claude-(fable|mythos)/.test(m)) return "high";
  const r = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(m);
  if (r) {
    const major = Number(r[1]), minor = r[2] ? Number(r[2]) : 0;
    return major > 4 || (major === 4 && minor >= 7) ? "high" : "standard";
  }
  return /^claude-\d/.test(m) ? "standard" : "high";
}

const imageTokens = (w: number, h: number) => Math.ceil(w / 28) * Math.ceil(h / 28);
function roundTiesToEven(v: number) {
  const f = Math.floor(v);
  if (v - f !== 0.5) return Math.round(v);
  return f % 2 === 0 ? f : f + 1;
}

/** The size Claude itself would downscale an image to (the documented reference implementation). Fitting images are returned unchanged. */
export function resizedSize(width: number, height: number, maxEdge: number, maxTokens: number): [number, number] {
  const fits = (w: number, h: number) => Math.ceil(w / 28) * 28 <= maxEdge && Math.ceil(h / 28) * 28 <= maxEdge && imageTokens(w, h) <= maxTokens;
  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = resizedSize(height, width, maxEdge, maxTokens);
    return [w, h];
  }
  const aspect = width / height;
  let lo = 1, hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(roundTiesToEven(mid / aspect), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundTiesToEven(lo / aspect), 1)];
}

// ───────────── cleaning model output ─────────────

// Known spellings and synonyms per field. Anything else falls back to the most conservative value,
// so an unexpected word never promotes a reading to "observed" and never discards the whole analysis.
const SYNONYMS: Record<string, [Record<string, string>, string]> = {
  basis: [{ observed: "observed", chart: "observed", visible: "observed", visible_on_chart: "observed", observation: "observed", inferred: "inferred", inference: "inferred", opinion: "inferred", history: "inferred", data: "inferred", likely: "inferred" }, "inferred"],
  reading: [{ observed: "observed", visible: "observed", visible_on_chart: "observed", chart: "observed", printed: "observed", inferred: "inferred", inference: "inferred", likely: "inferred", unknown: "unknown", not_visible: "unknown", unclear: "unknown", none: "unknown", n_a: "unknown" }, "unknown"],
  rule: [{ met: "met", followed: "met", satisfied: "met", yes: "met", not_met: "not_met", unmet: "not_met", broken: "not_met", violated: "not_met", no: "not_met", not_visible: "not_visible", unknown: "not_visible", cannot_tell: "not_visible", unclear: "not_visible", not_shown: "not_visible" }, "not_visible"],
  chartSource: [{ tradingview: "tradingview", trading_view: "tradingview", tv: "tradingview", mt5: "mt5", metatrader_5: "mt5", metatrader5: "mt5", meta_trader_5: "mt5", other: "other", not_a_chart: "not_a_chart", none: "not_a_chart" }, "other"],
  aspect: [{ trend: "trend", market_structure: "market_structure", structure: "market_structure", support_resistance: "support_resistance", support_and_resistance: "support_resistance", support: "support_resistance", resistance: "support_resistance", key_level: "support_resistance", key_levels: "support_resistance", levels: "support_resistance", aoi: "support_resistance", liquidity: "liquidity", entry_location: "entry_location", entry: "entry_location", other: "other" }, "other"],
};
const canon = (kind: string, v: string) => {
  const [map, fallback] = SYNONYMS[kind];
  return map[v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] ?? fallback;
};
const DIRECTION: Record<string, "long" | "short"> = { long: "long", buy: "long", bullish: "long", short: "short", sell: "short", bearish: "short" };

/**
 * The SDK's schema transform hands enum lists to the model as descriptions rather than hard constraints,
 * so map case, spacing and common synonyms ("Visible on chart", "not met", "MetaTrader 5", "buy") onto the
 * schema's values before validating against the zod schema.
 */
export function normalizeEnums(v: unknown, key = ""): unknown {
  if (Array.isArray(v)) return v.map((x) => normalizeEnums(x, key));
  if (!v || typeof v !== "object") return v;
  const src = v as Record<string, unknown>;
  // strategy rule verdicts carry an id; field readings don't
  const statusKind = "id" in src ? "rule" : "reading";
  const o = Object.fromEntries(Object.entries(src).map(([k, x]) => {
    if (typeof x !== "string") return [k, normalizeEnums(x, k)];
    if (k === "status") return [k, canon(statusKind, x)];
    if (k === "basis" || k === "chartSource" || k === "aspect") return [k, canon(k, x)];
    return [k, x];
  }));
  const dir = (o.fields as { direction?: { value?: unknown } } | undefined)?.direction;
  if (dir && typeof dir.value === "string") dir.value = DIRECTION[dir.value.trim().toLowerCase()] ?? null;
  return o;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export function cleanList(xs: string[], maxItems = 12, maxLen = 400) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const s = clip(x.trim(), maxLen);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Enforces the reading invariants: unknown ⇔ no value; prices finite and positive; nothing read from a non-chart. */
export function cleanFields(f: Fields, chartSource: (typeof CHART_SOURCES)[number]): Fields {
  const fix = <V>(r: { value: V | null; status: ReadingStatus; evidence: string }, ok: (v: V) => boolean) => {
    let value = r.value;
    if (typeof value === "string") value = (clip(value.trim(), 40) || null) as V | null;
    if (value !== null && !ok(value)) value = null;
    // a value the model itself marks unknown is dropped rather than promoted
    if (chartSource === "not_a_chart" || r.status === "unknown") value = null;
    const status: ReadingStatus = value === null ? "unknown" : r.status;
    return { value, status, evidence: clip(r.evidence.trim(), 400) };
  };
  const price = (v: number) => Number.isFinite(v) && v > 0;
  const any = () => true;
  return {
    symbol: fix(f.symbol, any), timeframe: fix(f.timeframe, any), direction: fix(f.direction, (v) => v === "long" || v === "short"),
    entry: fix(f.entry, price), stop: fix(f.stop, price), takeProfit: fix(f.takeProfit, price),
  };
}

// ───────────── computed parts ─────────────

/** R:R only from entry, stop and target that were all directly observed, and only when they sit on consistent sides. */
export function riskRewardFromReadings(f: Fields): ScreenshotAnalysis["riskReward"] {
  const missing = (["entry", "stop", "takeProfit"] as const).filter((k) => f[k].status !== "observed" || f[k].value === null);
  if (missing.length) {
    return { value: null, basis: "unknown", note: `Needs the entry, stop and target all visible on the chart; not observed: ${missing.map((k) => FIELD_LABEL[k].toLowerCase()).join(", ")}.` };
  }
  const e = f.entry.value!, s = f.stop.value!, t = f.takeProfit.value!;
  const risk = e - s, reward = t - e;
  if (risk === 0 || Math.sign(risk) !== Math.sign(reward)) return { value: null, basis: "unknown", note: "The visible stop and target aren't on opposite sides of the entry, so R:R can't be computed." };
  const dir = risk > 0 ? "long" : "short";
  if (f.direction.value && f.direction.value !== dir) return { value: null, basis: "unknown", note: `The visible levels describe a ${dir} trade but the direction reads ${f.direction.value}, so R:R isn't computed.` };
  return { value: Math.round((Math.abs(reward) / Math.abs(risk)) * 100) / 100, basis: "computed_from_visible_levels", note: "Computed by the app from the entry, stop and target read off the chart." };
}

export interface StrategyRuleInput { id: string; text: string; kind: string; required: boolean }

/** Joins the model's per-rule verdicts to the real rules (by id; the rule text always comes from the database) and derives the overall fit. */
export function strategyFitFrom(strategy: string | null, rules: StrategyRuleInput[], verdicts: AnalysisModelOutput["strategyRules"], summary: string): ScreenshotAnalysis["strategyFit"] {
  const byId = new Map(verdicts.map((v) => [v.id.trim().toUpperCase(), v]));
  const out = rules.map((r) => {
    const v = byId.get(r.id.toUpperCase());
    return { rule: r.text, kind: r.kind, required: r.required, status: v?.status ?? "not_visible", evidence: v ? clip(v.evidence.trim(), 400) : "Not assessed." };
  });
  return { strategy, overall: overallFit(out), rules: out, summary: strategy ? clip(summary.trim(), 600) : "No strategy is set on this trade, so there are no rules to check." };
}

export function overallFit(rules: { required: boolean; status: (typeof RULE_STATUS)[number] }[]): (typeof FIT)[number] {
  if (!rules.length) return "cannot_tell";
  const req = rules.filter((r) => r.required);
  if (req.some((r) => r.status === "not_met")) return "inconsistent";
  // with only optional rules there's nothing to be consistent with; the per-rule list says what was seen
  if (!req.length) return rules.every((r) => r.status === "not_visible") ? "cannot_tell" : "no_required";
  if (req.every((r) => r.status === "met")) return "consistent";
  return req.some((r) => r.status === "met") ? "partly" : "cannot_tell";
}

export function fitCounts(rules: { required: boolean; status: (typeof RULE_STATUS)[number] }[]) {
  const req = rules.filter((r) => r.required);
  return { required: req.length, met: req.filter((r) => r.status === "met").length, notMet: req.filter((r) => r.status === "not_met").length, notVisible: req.filter((r) => r.status === "not_visible").length };
}

/** "M15", "15", "15m", "H1", "60", "1h", "240", "D1", "1D", "Daily", "W1" → the trade form's timeframe options. Null when it isn't one of them. */
export const FORM_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1H", "4H", "D", "W"] as const;
export function toFormTimeframe(raw: string | null | undefined): (typeof FORM_TIMEFRAMES)[number] | null {
  if (!raw) return null;
  // monthly charts: TradingView writes "1M" (capital M; minutes are a bare number), MT5 "MN1"
  if (/^\s*(\d*\s*M|MN\d*|monthly|month)\s*$/i.test(raw) && !/^\s*\d*\s*m\s*$/.test(raw)) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, "").replace(/(minutes?|mins?)$/, "m").replace(/(hours?|hrs?)$/, "h");
  let mins: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^m(\d+)$/.exec(s)) || (m = /^(\d+)m$/.exec(s)) || (m = /^(\d+)$/.exec(s))) mins = Number(m[1]);
  else if ((m = /^h(\d+)$/.exec(s)) || (m = /^(\d+)h$/.exec(s))) mins = Number(m[1]) * 60;
  else if (/^(d|d1|1d|daily|day)$/.test(s)) return "D";
  else if (/^(w|w1|1w|weekly|week)$/.test(s)) return "W";
  const map: Record<number, (typeof FORM_TIMEFRAMES)[number]> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1H", 240: "4H", 1440: "D" };
  return mins !== null ? map[mins] ?? null : null;
}

export interface TradeRecordForCompare { symbol: string; direction: "long" | "short"; entryPrice: number; initialStop: number | null; takeProfit: number | null; timeframe: string | null }

/** Field-level mismatches between the chart readings and what the trader recorded. Prices allow for rounding of printed labels. */
export function recordDiscrepancies(f: Fields, rec: TradeRecordForCompare): ScreenshotAnalysis["discrepancies"] {
  const out: ScreenshotAnalysis["discrepancies"] = [];
  const add = (key: FieldKey, chart: string, record: string) => {
    const status = f[key].status;
    if (status !== "unknown") out.push({ topic: FIELD_LABEL[key], chart, record, basis: status, source: "app" });
  };
  if (f.symbol.value && normalizeSymbol(f.symbol.value) !== normalizeSymbol(rec.symbol)) add("symbol", f.symbol.value, rec.symbol);
  if (f.timeframe.value && rec.timeframe) {
    const a = toFormTimeframe(f.timeframe.value) ?? f.timeframe.value.trim().toLowerCase(), b = toFormTimeframe(rec.timeframe) ?? rec.timeframe.trim().toLowerCase();
    if (a !== b) add("timeframe", f.timeframe.value, rec.timeframe);
  }
  if (f.direction.value && f.direction.value !== rec.direction) add("direction", f.direction.value, rec.direction);
  const risk = rec.initialStop !== null ? Math.abs(rec.entryPrice - rec.initialStop) : 0;
  const differs = (chart: number, recorded: number) => Math.abs(chart - recorded) > Math.max(0.1 * risk, 0.0002 * Math.abs(recorded));
  const prices: [FieldKey, number | null][] = [["entry", rec.entryPrice], ["stop", rec.initialStop], ["takeProfit", rec.takeProfit]];
  for (const [k, recorded] of prices) {
    const v = f[k].value as number | null;
    if (v !== null && recorded !== null && differs(v, recorded)) add(k, String(v), String(recorded));
  }
  return out;
}

const FIELD_TOPIC = /\b(symbol|pair|instrument|ticker|time ?frame|direction|long|short|entry|stop|sl|take ?profit|target|tp)\b/i;
/** Keeps the model's discrepancies that aren't one of the six fields (the app checks those itself). */
export function otherDiscrepancies(xs: AnalysisModelOutput["discrepancies"]): ScreenshotAnalysis["discrepancies"] {
  return xs
    .filter((d) => !FIELD_TOPIC.test(d.topic))
    .slice(0, 8)
    .map((d) => ({ topic: clip(d.topic.trim(), 80), chart: clip(d.chart.trim(), 300), record: clip(d.record.trim(), 300), basis: d.basis, source: "ai" as const }));
}

export interface AnalysisContext {
  record: TradeRecordForCompare;
  strategy: string | null;
  rules: StrategyRuleInput[];
  image: ScreenshotAnalysis["image"];
  promptVersion: string;
}

/** Model output + app-side checks → the stored analysis. */
/**
 * A stored analysis checked against the trade as it is now. The app's chart-vs-record comparisons are recomputed
 * from the stored readings, so a corrected record stops showing an old mismatch; strategyChanged says the rules
 * were checked against a strategy the trade no longer has.
 */
export function againstCurrentRecord(a: ScreenshotAnalysis, rec: TradeRecordForCompare, strategy: string | null) {
  return {
    analysis: { ...a, discrepancies: [...recordDiscrepancies(a.fields, rec), ...a.discrepancies.filter((d) => d.source === "ai")] },
    strategyChanged: (a.strategyFit.strategy ?? null) !== (strategy ?? null),
  };
}

export function buildAnalysis(out: AnalysisModelOutput, ctx: AnalysisContext): ScreenshotAnalysis {
  const fields = cleanFields(out.fields, out.chartSource);
  return {
    chartSource: out.chartSource,
    fields,
    observed: cleanList(out.observed),
    inferred: cleanList(out.inferred),
    unknown: cleanList(out.unknown, 8),
    structure: out.structure.slice(0, 10).map((s) => ({ aspect: s.aspect, note: clip(s.note.trim(), 400), basis: s.basis })).filter((s) => s.note),
    riskReward: riskRewardFromReadings(fields),
    strategyFit: strategyFitFrom(ctx.strategy, ctx.rules, out.strategyRules, out.strategySummary),
    discrepancies: [...recordDiscrepancies(fields, ctx.record), ...otherDiscrepancies(out.discrepancies)],
    summary: clip(out.summary.trim(), 800),
    image: ctx.image,
    promptVersion: ctx.promptVersion,
  };
}

// ───────────── quick entry: filling the trade form ─────────────

export interface FormSnapshot { symbol: string; direction: "long" | "short"; entryPrice: string; initialStop: string; takeProfit: string; timeframe: string }
export type FormPatch = Partial<FormSnapshot>;
type FormKey = keyof FormSnapshot;
const FORM_KEY: Record<FieldKey, FormKey> = { symbol: "symbol", timeframe: "timeframe", direction: "direction", entry: "entryPrice", stop: "initialStop", takeProfit: "takeProfit" };

export interface FillRow {
  key: FieldKey; label: string; reading: string | null; status: ReadingStatus; evidence: string;
  /** what would be written into the form, or null when the reading can't be used */
  formValue: string | null;
  /** the form field is empty (direction: not chosen yet) */
  empty: boolean;
  /** current form value, for showing a difference */
  current: string;
  /** offered as a per-field "Use" button */
  canUse: boolean;
  /** applied by "Fill empty fields": only observed readings, only into empty fields */
  autoFill: boolean;
  note: string | null;
}

/** Decides, per field, what quick entry may write. Never touches a field that already has a value. */
export function fillPlan(f: Fields, form: FormSnapshot, directionChosen: boolean): FillRow[] {
  return FIELD_KEYS.map((key) => {
    const r = f[key];
    const fk = FORM_KEY[key];
    const current = String(form[fk] ?? "");
    const empty = fk === "direction" ? !directionChosen : current.trim() === "";
    let formValue: string | null = null;
    let note: string | null = null;
    if (r.value !== null) {
      if (key === "symbol") formValue = normalizeSymbol(String(r.value)) || null;
      else if (key === "timeframe") { formValue = toFormTimeframe(String(r.value)); if (!formValue) note = "Not one of the form's timeframe options."; }
      else formValue = String(r.value);
    }
    const canUse = formValue !== null && empty && r.status !== "unknown";
    if (formValue !== null && !empty && formValue !== current) note = `Form has ${current}; left unchanged.`;
    return {
      key, label: FIELD_LABEL[key], reading: r.value === null ? null : String(r.value), status: r.status, evidence: r.evidence,
      formValue, empty, current, canUse, autoFill: canUse && r.status === "observed", note,
    };
  });
}

export function patchFor(rows: FillRow[], keys: FieldKey[]): FormPatch {
  const patch: Record<string, string> = {};
  for (const r of rows) if (keys.includes(r.key) && r.canUse && r.formValue !== null) patch[FORM_KEY[r.key]] = r.formValue;
  return patch as FormPatch;
}
