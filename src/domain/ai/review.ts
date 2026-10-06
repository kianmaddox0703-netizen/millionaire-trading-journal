import { z } from "zod";
import { BASIS, REDACTION, collectStrings, scrubDeep, type Basis } from "./guard";
import { MISTAKES, MISTAKE_LABEL, type MistakeKey, type RiskRules } from "../mistakes";
import { STRENGTH_LABEL, type Strength } from "../metrics";
import { DAYS } from "../sessions";
import type { Similarity, TradeReview } from "../review";

/**
 * AI trade review: the data packet sent to the model (pure, tested), the structured output
 * the model must return, and the checks applied to that output before it is stored.
 *
 * The model writes prose; every number it may repeat comes from the app. Its historical
 * comparison is checked against the app's similarity statistics, its mistake suggestions must
 * quote the trader's own records, and it never scores setup quality.
 */

export const MISTAKE_KEYS = MISTAKES.map((m) => m.key) as [MistakeKey, ...MistakeKey[]];
export const PLAN_STATUS = ["followed", "broken", "not_recorded"] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = { followed: "Followed", broken: "Broken", not_recorded: "Not recorded" };
const STRENGTHS = ["insufficient", "weak", "moderate", "strong"] as const satisfies readonly Strength[];

export const Point = z.object({ text: z.string(), basis: z.enum(BASIS) });
export type Point = z.infer<typeof Point>;

// The SDK sends enums to the API as a description hint, not as a grammar constraint, so an enum value can
// come back in another spelling. These map the likely spellings before validation; anything else is
// labelled "inference" (a basis), "not_recorded" (a plan status) or dropped (a mistake key).
const slug = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : "");
const BASIS_SYNONYM: Record<string, Basis> = {
  data: "data", record: "data", records: "data", your_records: "data", recorded: "data", recorded_data: "data", objective_data: "data", market_data: "data",
  history: "history", historical: "history", historical_evidence: "history", statistics: "history", statistic: "history",
  chart: "chart", visible_on_chart: "chart", observed: "chart", screenshot: "chart", visual: "chart", visual_observation: "chart",
  inference: "inference", inferred: "inference", interpretation: "inference",
  opinion: "opinion", judgement: "opinion", judgment: "opinion", suggestion: "opinion", advice: "opinion",
};
const STATUS_SYNONYM: Record<string, PlanStatus> = {
  followed: "followed", met: "followed", respected: "followed", yes: "followed",
  broken: "broken", not_met: "broken", violated: "broken", no: "broken",
  not_recorded: "not_recorded", unknown: "not_recorded", not_visible: "not_recorded", unclear: "not_recorded", not_assessed: "not_recorded",
};
const lookup = <T>(map: Record<string, T>, v: unknown): T | undefined => (Object.hasOwn(map, slug(v)) ? map[slug(v)] : undefined);
export const coerceBasis = (v: unknown): Basis => lookup(BASIS_SYNONYM, v) ?? "inference";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const mapArr = (v: unknown, f: (x: Record<string, unknown>) => Record<string, unknown> | null) => (Array.isArray(v) ? v.flatMap((x) => (isObj(x) ? [f(x)].filter((y) => y !== null) : [x])) : v);
export const withBasis = (v: unknown) => mapArr(v, (p) => ({ ...p, basis: coerceBasis(p.basis) }));

/** Maps enum spellings in the model's raw JSON to the schema's values before validation. */
export function normalizeReviewJson(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  return {
    ...raw,
    wentWell: withBasis(raw.wentWell),
    issues: withBasis(raw.issues),
    planCheck: mapArr(raw.planCheck, (p) => ({ ...p, status: lookup(STATUS_SYNONYM, p.status) ?? "not_recorded" })),
    suggestedMistakes: mapArr(raw.suggestedMistakes, (p) => (Object.hasOwn(MISTAKE_LABEL, slug(p.key)) ? { ...p, key: slug(p.key) } : null)),
  };
}

/** What the model is asked to return. Kept simple for structured outputs; everything is re-checked afterwards. */
export const ReviewModelOutput = z.object({
  headline: z.string(),
  wentWell: z.array(Point),
  issues: z.array(Point),
  planCheck: z.array(z.object({ id: z.string(), status: z.enum(PLAN_STATUS), evidence: z.string() })),
  historicalComparison: z.object({ text: z.string() }),
  suggestedMistakes: z.array(z.object({ key: z.enum(MISTAKE_KEYS), quote: z.string(), evidence: z.string() })),
  lesson: z.object({ text: z.string() }),
});
export type ReviewModelOutput = z.infer<typeof ReviewModelOutput>;

/** What is stored in ai_analysis.output (kind "trade_review") and rendered. */
export const StoredTradeReview = z.object({
  headline: z.string(),
  wentWell: z.array(Point),
  issues: z.array(Point),
  planCheck: z.array(z.object({ id: z.string(), rule: z.string(), group: z.string(), required: z.boolean(), status: z.enum(PLAN_STATUS), evidence: z.string() })),
  historicalComparison: z.object({ text: z.string(), basis: z.literal("history"), n: z.number(), strength: z.enum(STRENGTHS).nullable(), source: z.enum(["ai", "app"]) }),
  suggestedMistakes: z.array(z.object({ key: z.string(), label: z.string(), quote: z.string(), evidence: z.string() })),
  lesson: z.object({ text: z.string(), basis: z.literal("opinion") }),
  /** suggestions removed because the quote wasn't found in the trader's records */
  droppedSuggestions: z.number(),
  /** sentences replaced by the certainty guard */
  redactions: z.number(),
  promptVersion: z.string(),
});
export type StoredTradeReview = z.infer<typeof StoredTradeReview>;

export function parseStoredReview(output: string): StoredTradeReview | null {
  try {
    const r = StoredTradeReview.safeParse(JSON.parse(output));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ───────────── packet input ─────────────

export interface PacketTrade {
  id: string; seq: number; symbol: string; direction: "long" | "short"; status: "open" | "closed"; source: string;
  openedAt: Date; closedAt: Date | null;
  entryPrice: number; initialStop: number | null; takeProfit: number | null; exitPrice: number | null; sizeLots: number | null;
  riskAmount: number | null; riskPct: number | null; grossPnl: number | null; commission: number; swap: number; fees: number;
  netPnl: number | null; pnlPct: number | null; rMultiple: number | null; plannedRr: number | null;
  session: string | null; timeframe: string | null; marketCondition: string | null; trend: string | null; htfBias: string | null;
  setupQuality: string | null; entryConfirmation: string | null; confluences: string; setupScore: number | null;
}

export const NOTE_FIELDS = [
  ["why", "Why did I take this trade?"], ["observed", "What did I see?"], ["thesis", "Thesis"], ["whatHappened", "What happened?"],
  ["didWell", "What I did well"], ["didPoorly", "What I did poorly"], ["wouldChange", "What I would change"], ["lesson", "Lesson learned"],
] as const;
export type Notes = Partial<Record<(typeof NOTE_FIELDS)[number][0], string>>;

const PSYCH_FLAGS = [["fomo", "FOMO"], ["revenge", "Revenge trade"], ["movedStop", "Moved stop"], ["exitedEarly", "Exited early"], ["overtraded", "Overtraded"], ["lateEntry", "Late entry"], ["oversized", "Oversized"]] as const;
export interface Psych { confidence: number | null; discipline: number | null; followedPlan: boolean | null; fomo: boolean; revenge: boolean; movedStop: boolean; exitedEarly: boolean; overtraded: boolean; lateEntry: boolean; oversized: boolean }

export interface ScreenshotDigest { kind: string; at: Date; chartSource: string | null; summary: string | null; observed: string[]; inferred: string[]; unknown: string[]; fit: string | null; fitSummary: string | null }

export interface ReviewPacketInput {
  trade: PacketTrade;
  tz: string;
  currency: string;
  strategy: { name: string; rules: { kind: string; text: string; required: boolean }[] } | null;
  setupName: string | null;
  notes: Notes | null;
  psych: Psych | null;
  emotions: { phase: string; emotion: string; intensity: number | null }[];
  checklist: { phase: "pre" | "post"; item: string; checked: boolean | null; answer: string | null }[];
  factors: { label: string; weight: number; rating: number | null }[];
  mistakes: { key: string; source: string; note: string }[];
  review: TradeReview;
  riskRules: RiskRules;
  alerts: { symbol: string | null; timeframe: string | null; side: string | null; price: number | null; setup: string | null; message: string | null; at: Date; status: string }[];
  screenshots: ScreenshotDigest[];
  market: { provider: string; instrument: string | null; trend: string | null; htfBias: string | null; session: string | null; volatility: string | null; atr: number | null; nearKeyLevel: boolean | null; computedAt: Date } | null;
}

export interface PlanItem { id: string; rule: string; group: string; required: boolean }

export interface SimilaritySnapshot {
  traits: string[];
  threshold: number;
  n: number; wins: number; losses: number; breakevens: number;
  winRate: number | null; winRateCi: { low: number; high: number } | null;
  avgR: number | null; medianR: number | null; totalR: number;
  strength: Strength | null;
  baseline: { avgR: number | null; winRate: number | null };
}

export interface ReviewPacket {
  text: string;
  planItems: PlanItem[];
  similarity: SimilaritySnapshot;
  /** the trader's own recorded words and field lines; suggested mistakes must quote from here */
  corpus: string;
  existingMistakes: string[];
  hasScreenshots: boolean;
  /** numbers out of 10 that legitimately appear in the record (setup score, confidence, discipline) */
  scoreNumbers: number[];
}

// ───────────── formatting ─────────────

const has = (v: unknown) => v !== null && v !== undefined && v !== "";
const show = (v: unknown) => (has(v) ? String(v) : "not recorded");
const n2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "not recorded" : v.toFixed(d));
const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(d)}%`);
const signedR = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);

export function localTime(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function duration(a: Date, b: Date | null) {
  if (!b) return "still open";
  const m = Math.round((b.getTime() - a.getTime()) / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

const RATING = ["absent", "partial", "clear"];

/** The trader's risk rules as plan items, in words. Only rules that are set. */
export function riskPlanRules(r: RiskRules, tz: string): string[] {
  const out: string[] = [];
  if (r.maxRiskPct) out.push(`Risk at most ${r.maxRiskPct}% of the account per trade`);
  if (r.minRr) out.push(`Planned reward:risk of at least 1:${r.minRr}`);
  if (r.maxTradesPerDay) out.push(`At most ${r.maxTradesPerDay} trades per day`);
  if (r.maxDailyLossPct) out.push(`Stop trading for the day after losing ${r.maxDailyLossPct}%`);
  if (r.maxWeeklyLossPct) out.push(`Stop trading for the week after losing ${r.maxWeeklyLossPct}%`);
  if (r.maxConsecutiveLosses) out.push(`Stop after ${r.maxConsecutiveLosses} consecutive losses`);
  if (r.tradingHoursStart && r.tradingHoursEnd) out.push(`Open trades only between ${r.tradingHoursStart} and ${r.tradingHoursEnd} (${tz})`);
  const days = (r.restrictedDays ?? "").split(",").filter(Boolean).map((d) => DAYS[Number(d)]).filter(Boolean);
  if (days.length) out.push(`No trading on ${days.join(", ")}`);
  if (r.requireChecklist) out.push("Complete the pre-trade checklist before entering");
  return out;
}

export function similaritySnapshot(s: Similarity): SimilaritySnapshot {
  const pnls = s.matches.map((m) => m.netPnl ?? 0);
  return {
    traits: s.traits.map((t) => `${t.name}: ${t.value}`),
    threshold: s.threshold,
    n: s.stat?.n ?? 0,
    wins: pnls.filter((p) => p > 0).length,
    losses: pnls.filter((p) => p < 0).length,
    breakevens: pnls.filter((p) => p === 0).length,
    winRate: s.stat?.winRate ?? null,
    winRateCi: s.stat?.winRateCi ?? null,
    avgR: s.stat?.avgR ?? null,
    medianR: s.stat?.medianR ?? null,
    totalR: s.stat?.totalR ?? 0,
    strength: s.stat?.strength ?? null,
    baseline: { avgR: s.baseline.avgR, winRate: s.baseline.winRate },
  };
}

/** The app's own wording of the historical comparison, used when the model's text can't be verified. */
export function historySentence(s: SimilaritySnapshot): string {
  if (s.traits.length < 2) return "Not enough characteristics are recorded on this trade (strategy, setup, session, quality, timeframe) to compare it with your history.";
  if (s.n === 0) return `No earlier trades share at least ${s.threshold} of this trade's ${s.traits.length} recorded characteristics, so there isn't enough history to compare with yet.`;
  const strength = s.strength ? STRENGTH_LABEL[s.strength] : "Insufficient sample";
  return `${s.n} earlier trade${s.n === 1 ? "" : "s"} shared at least ${s.threshold} of ${s.traits.length} characteristics with this one. They won ${pct(s.winRate, 0)} of decided trades at an average of ${signedR(s.avgR)} (all your earlier trades: ${pct(s.baseline.winRate, 0)}, ${signedR(s.baseline.avgR)}). ${strength} (n=${s.n}): this describes how similar past trades went, not this one.`;
}

/** Numbers the historical comparison may contain: the similarity statistics and the sample-size thresholds. */
export function historyNumbers(s: SimilaritySnapshot): number[] {
  const xs = [s.n, s.wins, s.losses, s.breakevens, s.threshold, s.traits.length, s.totalR, 10, 30, 95, 100];
  for (const v of [s.avgR, s.medianR, s.baseline.avgR]) if (v !== null) xs.push(v);
  for (const v of [s.winRate, s.baseline.winRate, s.winRateCi?.low ?? null, s.winRateCi?.high ?? null]) if (v !== null) xs.push(v * 100, v);
  for (const t of s.traits) for (const m of t.match(/\d+(?:\.\d+)?/g) ?? []) xs.push(Number(m));
  return xs;
}

// a leading sign counts only when it isn't a hyphen inside a range or word ("40-60%", "5-trade")
const NUM = /(?:(?<![\w.])[-−+])?\d+(?:[.,]\d+)?/g;
/**
 * True when every number in the text is a (rounded) restatement of an allowed number.
 * A number written with a sign must match in sign too, so "+0.45R" can't restate an average of −0.45R.
 */
export function numbersAllowed(text: string, allowed: number[]) {
  for (const raw of text.match(NUM) ?? []) {
    const s = raw.replace("−", "-").replace(",", ".");
    const signed = /^[-+]/.test(s);
    const x = Number(s);
    const decimals = (s.split(".")[1] ?? "").length;
    const tol = 0.5 * 10 ** -decimals + 1e-9;
    if (!allowed.some((a) => (signed ? Math.abs(x - a) : Math.abs(Math.abs(x) - Math.abs(a))) <= tol)) return false;
  }
  return true;
}

const normalize = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const EDGE = /^["'\s.,;:!?()-]+|["'\s.,;:!?()-]+$/g;

/** True when the quote (or each part of it around "...") appears in the trader's own records. */
export function quoteFound(quote: string, corpus: string) {
  const parts = normalize(quote).split(/\s*(?:\.\.\.|…)\s*/).map((p) => p.replace(EDGE, "")).filter(Boolean);
  if (!parts.length || parts.join(" ").length < 4) return false;
  const c = normalize(corpus);
  return parts.every((p) => p.length < 3 || c.includes(p));
}

// ───────────── packet ─────────────

/**
 * Builds the user message for the review. Pure: the caller passes only this user's data.
 * Trader-entered values are rendered as "Label: value" lines so a suggested mistake can quote one.
 */
export function buildReviewPacket(i: ReviewPacketInput): ReviewPacket {
  const t = i.trade;
  const tz = i.tz;
  const record = [
    `Trade #${t.seq}`,
    `Symbol: ${t.symbol}`,
    `Direction: ${t.direction}`,
    `Status: ${t.status}`,
    `Account currency: ${i.currency}`,
    `Opened: ${localTime(t.openedAt, tz)} (${tz})`,
    `Closed: ${t.closedAt ? `${localTime(t.closedAt, tz)} (${tz})` : "still open"}`,
    `Duration: ${duration(t.openedAt, t.closedAt)}`,
    `Entry price: ${t.entryPrice}`,
    `Stop loss: ${show(t.initialStop)}`,
    `Take profit: ${show(t.takeProfit)}`,
    `Exit price: ${show(t.exitPrice)}`,
    `Size (lots): ${show(t.sizeLots)}`,
    `Risk amount: ${n2(t.riskAmount)}`,
    `Risk % of account: ${n2(t.riskPct)}`,
    `Planned reward:risk: ${t.plannedRr !== null ? `1:${t.plannedRr.toFixed(2)}` : "not recorded"}`,
    `Net P&L: ${n2(t.netPnl)} (gross ${n2(t.grossPnl)}, commission ${n2(t.commission)}, swap ${n2(t.swap)}, fees ${n2(t.fees)})`,
    `R multiple: ${t.rMultiple !== null ? t.rMultiple.toFixed(2) : "not recorded"}`,
    `Session: ${show(t.session)}`,
    `Timeframe: ${show(t.timeframe)}`,
    `Market condition: ${show(t.marketCondition)}`,
    `Trend: ${show(t.trend)}`,
    `Higher-timeframe bias: ${show(t.htfBias)}`,
    `Entry confirmation: ${show(t.entryConfirmation)}`,
    `Confluences: ${show(t.confluences)}`,
    `Your setup grade: ${show(t.setupQuality)}`,
    `Strategy: ${i.strategy?.name ?? "none"}`,
    `Setup: ${show(i.setupName)}`,
    `Recorded via: ${t.source}`,
  ];

  const notes = NOTE_FIELDS.filter(([k]) => has(i.notes?.[k])).map(([k, label]) => `[${label}]\n${i.notes![k]!.trim()}`);

  const psych: string[] = [];
  if (i.psych) {
    psych.push(`Confidence (1-10): ${show(i.psych.confidence)}`, `Discipline (1-10): ${show(i.psych.discipline)}`);
    psych.push(`Followed plan: ${i.psych.followedPlan === null ? "not answered" : i.psych.followedPlan ? "yes" : "no"}`);
    const flags = PSYCH_FLAGS.filter(([k]) => i.psych![k]).map(([, l]) => l);
    psych.push(`Flags you marked: ${flags.length ? flags.join(", ") : "none"}`);
  }
  for (const e of i.emotions) psych.push(`Emotion ${e.phase}: ${e.emotion}${e.intensity !== null ? ` (intensity ${e.intensity})` : ""}`);

  const checklist = i.checklist.map((c) =>
    c.phase === "pre"
      ? `Pre-trade: [${c.checked === null ? " " : c.checked ? "x" : " "}] ${c.item}${c.checked === null ? " (not answered)" : ""}${c.answer ? ` - ${c.answer}` : ""}`
      : `After-trade: ${c.item}${c.checked !== null ? ` - ${c.checked ? "Yes" : "No"}` : ""}${c.answer ? ` - ${c.answer}` : ""}`);

  const rated = i.factors.filter((f) => f.rating !== null);
  const factorLines = i.factors.map((f) => `${f.label} (weight ${f.weight}): ${f.rating === null ? "not rated" : RATING[f.rating] ?? f.rating}`);
  const score = [
    `App-computed setup score from your factor ratings: ${t.setupScore !== null ? `${t.setupScore.toFixed(1)} of 10` : "none (no factors rated)"} (${rated.length} of ${i.factors.length} factors rated). It measures how complete the setup was by your own definition, not a probability. Don't restate it as your own rating and don't produce another score.`,
    ...factorLines,
  ];

  const mistakes = i.mistakes.map((m) => `${m.key} (${MISTAKE_LABEL[m.key] ?? m.key}), ${m.source === "rule" ? "detected by the app from your rules" : m.source === "user" ? "tagged by you" : "suggested earlier"}${m.note ? `: ${m.note}` : ""}`);

  const sim = similaritySnapshot(i.review.similarity);
  const simLines = sim.traits.length < 2
    ? ["Not enough characteristics recorded to compare with history (needs at least two of strategy, setup, symbol, session, quality, trend, target, timeframe)."]
    : [
      `This trade's characteristics: ${sim.traits.join("; ")}`,
      `Match rule: earlier closed trades in the same account sharing at least ${sim.threshold} of these ${sim.traits.length}.`,
      ...(sim.n === 0 ? ["Similar earlier trades: 0. There isn't enough history to compare with."] : [
        `Similar earlier trades: n=${sim.n} (${sim.wins} wins, ${sim.losses} losses, ${sim.breakevens} breakeven)`,
        `Win rate of similar trades: ${pct(sim.winRate)}${sim.winRateCi ? ` (95% interval ${pct(sim.winRateCi.low, 0)} to ${pct(sim.winRateCi.high, 0)})` : ""}`,
        `Average R of similar trades: ${signedR(sim.avgR)} (median ${signedR(sim.medianR)}, total ${signedR(sim.totalR)})`,
        `Evidence strength: ${sim.strength ? STRENGTH_LABEL[sim.strength] : "Insufficient sample"} (n=${sim.n})`,
      ]),
      `Baseline, all your earlier closed trades in this account: win rate ${pct(sim.baseline.winRate)}, average ${signedR(sim.baseline.avgR)}`,
    ];

  const planItems: PlanItem[] = [
    ...(i.strategy?.rules ?? []).map((r, k) => ({ id: `R${k + 1}`, rule: r.text, group: r.kind, required: r.required })),
    ...riskPlanRules(i.riskRules, tz).map((rule, k) => ({ id: `K${k + 1}`, rule, group: "risk", required: true })),
  ];
  const planLines = [
    i.strategy ? `Strategy: ${i.strategy.name}${i.setupName ? ` (setup: ${i.setupName})` : ""}` : "No strategy is set on this trade.",
    "id | group | required | rule",
    ...planItems.map((p) => `${p.id} | ${p.group === "risk" ? "risk rule" : p.group} | ${p.required ? "required" : "optional"} | ${p.rule}`),
  ];
  if (!planItems.length) planLines.push("(no strategy rules and no risk rules are set; return an empty planCheck)");

  const alerts = i.alerts.map((a) => `${localTime(a.at, tz)} ${show(a.symbol)}${a.timeframe ? ` ${a.timeframe}` : ""}${a.side ? ` ${a.side}` : ""}${a.price !== null ? ` @ ${a.price}` : ""}${a.setup ? ` setup "${a.setup}"` : ""} (${a.status} link)${a.message ? `: ${a.message.slice(0, 300)}` : ""}`);

  const shots = i.screenshots.flatMap((s, k) => [
    `Screenshot ${k + 1} (${s.kind}), read by AI on ${localTime(s.at, tz)}${s.chartSource ? `, source ${s.chartSource}` : ""}`,
    ...(s.summary ? [`  Summary: ${s.summary}`] : []),
    ...s.observed.map((x) => `  Observed: ${x}`),
    ...s.inferred.map((x) => `  Inferred: ${x}`),
    ...s.unknown.map((x) => `  Not visible: ${x}`),
    ...(s.fit ? [`  Strategy fit from the image: ${s.fit}${s.fitSummary ? `. ${s.fitSummary}` : ""}`] : []),
  ]);

  const m = i.market;
  const market = m ? [
    `Computed by the app from ${m.provider} H1 candles up to the entry${m.instrument ? ` (${m.instrument})` : ""} on ${localTime(m.computedAt, tz)}. Market data, not the trader's record.`,
    `Trend (H1): ${show(m.trend)}`, `Higher-timeframe bias (H4): ${show(m.htfBias)}`, `Session: ${show(m.session)}`, `Volatility: ${show(m.volatility)}`,
    `ATR14 (H1): ${show(m.atr)}`, `Near a key level at entry: ${m.nearKeyLevel === null ? "unknown" : m.nearKeyLevel ? "yes" : "no"}`,
  ] : [];

  const section = (tag: string, lines: string[]) => (lines.length ? `<${tag}>\n${lines.join("\n")}\n</${tag}>` : "");
  const text = [
    "Review this trade. Everything below comes from the app's database for this one trader. Sections that are missing have no data.",
    section("trade_record", record),
    section("journal_notes", notes),
    section("psychology", psych),
    section("checklist", checklist),
    section("setup_score", score),
    section("mistakes_recorded", mistakes.length ? mistakes : ["none"]),
    section("app_review", [...i.review.well.map((w) => `Went well (app): ${w}`), ...i.review.issues.map((w) => `Issue (app): ${w}`)]),
    section("similarity", simLines),
    section("plan", planLines),
    section("tradingview_alerts", alerts),
    section("screenshot_readings", shots),
    section("market_context", market),
  ].filter(Boolean).join("\n\n");

  const corpus = [...record, ...notes, ...psych, ...checklist, ...factorLines, ...alerts].join("\n");
  const scoreNumbers = [t.setupScore, i.psych?.confidence ?? null, i.psych?.discipline ?? null, ...i.emotions.map((e) => e.intensity)].filter((x): x is number => x !== null);
  return { text, planItems, similarity: sim, corpus, existingMistakes: [...new Set(i.mistakes.map((x) => x.key))], hasScreenshots: i.screenshots.length > 0, scoreNumbers };
}

// ───────────── output checks ─────────────

const clip = (s: string, max = 600) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Trims, drops empty points, caps the list. "chart" is only allowed when screenshot readings were provided. */
export function cleanPoints(xs: Point[], allowChart: boolean, max = 6): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const p of xs) {
    const text = clip(p.text.trim());
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, basis: p.basis === "chart" && !allowChart ? ("inference" as Basis) : p.basis });
    if (out.length >= max) break;
  }
  return out;
}

const SCORE = /\b(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*10\b/gi;
/** Removes quality scores the model made up ("8/10 setup"); scores the record contains stay. */
export function stripInventedScores(text: string, allowed: number[]) {
  return text.replace(SCORE, (match, num: string, offset: number) => {
    const around = text.slice(Math.max(0, offset - 40), offset + match.length + 40);
    if (!/score|quality|grade|rated|rating/i.test(around)) return match;
    const x = Number(num);
    return allowed.some((a) => Math.abs(a - x) < 0.051) ? match : "[score removed: the app shows your own setup score]";
  });
}

function mapStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === "string") return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)])) as T;
  return v;
}

export const countRedactions = (v: unknown) => collectStrings(v).reduce((a, s) => a + s.split(REDACTION).length - 1, 0);

/** Turns the model's answer into the stored review: verified, capped, scrubbed. */
export function finalizeReview(out: ReviewModelOutput, packet: ReviewPacket, promptVersion: string): StoredTradeReview {
  const allowChart = packet.hasScreenshots;
  const byId = new Map(packet.planItems.map((p) => [p.id, p]));
  const verdicts = new Map<string, ReviewModelOutput["planCheck"][number]>();
  for (const v of out.planCheck) if (byId.has(v.id.trim()) && !verdicts.has(v.id.trim())) verdicts.set(v.id.trim(), v);
  const planCheck = packet.planItems.map((p) => {
    const v = verdicts.get(p.id);
    return { id: p.id, rule: p.rule, group: p.group, required: p.required, status: v?.status ?? "not_recorded", evidence: clip(v?.evidence.trim() || "Not assessed in this review.", 400) };
  });

  const sim = packet.similarity;
  const aiHistory = out.historicalComparison.text.trim();
  const useAi = sim.n > 0 && aiHistory.length > 0 && numbersAllowed(aiHistory, historyNumbers(sim));
  const historicalComparison = { text: useAi ? clip(aiHistory) : historySentence(sim), basis: "history" as const, n: sim.n, strength: sim.strength, source: useAi ? ("ai" as const) : ("app" as const) };

  const existing = new Set(packet.existingMistakes);
  const suggestedMistakes: StoredTradeReview["suggestedMistakes"] = [];
  let droppedSuggestions = 0;
  for (const s of out.suggestedMistakes) {
    if (!Object.hasOwn(MISTAKE_LABEL, s.key) || existing.has(s.key) || suggestedMistakes.some((x) => x.key === s.key)) continue;
    const quote = s.quote.trim(), evidence = s.evidence.trim();
    if (!quote || !evidence || !quoteFound(quote, packet.corpus)) { droppedSuggestions++; continue; }
    suggestedMistakes.push({ key: s.key, label: MISTAKE_LABEL[s.key], quote: clip(quote, 300), evidence: clip(evidence, 400) });
    if (suggestedMistakes.length >= 5) break;
  }

  const review: StoredTradeReview = {
    headline: clip(out.headline.trim(), 300),
    wentWell: cleanPoints(out.wentWell, allowChart),
    issues: cleanPoints(out.issues, allowChart),
    planCheck,
    historicalComparison,
    suggestedMistakes,
    lesson: { text: clip(out.lesson.text.trim(), 400), basis: "opinion" },
    droppedSuggestions,
    redactions: 0,
    promptVersion,
  };
  const noScores = mapStrings(review, (s) => stripInventedScores(s, packet.scoreNumbers));
  const scrubbed = scrubDeep(noScores).value;
  // The guard is for what the AI wrote. Your own rule text and the quotes verified as your words stay as written.
  const final = {
    ...scrubbed,
    planCheck: scrubbed.planCheck.map((p, i) => ({ ...p, rule: planCheck[i].rule })),
    suggestedMistakes: scrubbed.suggestedMistakes.map((m, i) => ({ ...m, quote: suggestedMistakes[i].quote })),
  };
  return { ...final, redactions: countRedactions(final) };
}
