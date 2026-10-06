import { z } from "zod";
import { scrubDeep } from "./guard";
import { Point, cleanPoints, countRedactions, withBasis } from "./review";
import { summarize, STRENGTH_LABEL, type Summary } from "../metrics";
import { groupStats, type GroupStat } from "../edge";
import { MISTAKE_LABEL, type RiskRules } from "../mistakes";
import { addDays, weekStartOf } from "../sessions";
import type { PeriodReport, PeriodTrade } from "../period";

/**
 * AI weekly and monthly summaries. The packet reuses the numbers the review pages show
 * (periodReport over the same trades), adds per-group statistics with n and strength, the
 * trader's written answers and, for a month, the previous months. The model writes the prose.
 */

export type PeriodKind = "weekly" | "monthly";

export const PeriodModelOutput = z.object({
  summary: z.string(),
  performance: z.array(Point),
  process: z.array(Point),
  psychology: z.array(Point),
  keep: z.array(Point),
  stop: z.array(Point),
  change: z.array(Point),
  focus: z.object({ text: z.string() }),
  comparison: z.array(Point),
  caveats: z.array(z.string()),
});
export type PeriodModelOutput = z.infer<typeof PeriodModelOutput>;

export const StoredPeriodSummary = z.object({
  kind: z.enum(["weekly", "monthly"]),
  period: z.string(),
  summary: z.string(),
  performance: z.array(Point),
  process: z.array(Point),
  psychology: z.array(Point),
  keep: z.array(Point),
  stop: z.array(Point),
  change: z.array(Point),
  focus: z.object({ text: z.string(), basis: z.literal("opinion") }),
  comparison: z.array(Point),
  /** the app's own sample-size caveats */
  caveats: z.array(z.string()),
  /** caveats the AI added; shown apart from the app's so unchecked text doesn't read as the app's warning */
  aiCaveats: z.array(z.string()).default([]),
  /** what the summary was computed from, to tell when it is out of date */
  basedOn: z.object({ trades: z.number(), lastTradeChange: z.number().nullable(), answersChanged: z.number().nullable() }),
  redactions: z.number(),
  promptVersion: z.string(),
});
export type StoredPeriodSummary = z.infer<typeof StoredPeriodSummary>;

/** Maps basis spellings in the model's raw JSON before validation (see normalizeReviewJson). */
export function normalizePeriodJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  for (const k of ["performance", "process", "psychology", "keep", "stop", "change", "comparison"]) o[k] = withBasis(o[k]);
  return o;
}

export function parseStoredPeriod(output: string): StoredPeriodSummary | null {
  try {
    const r = StoredPeriodSummary.safeParse(JSON.parse(output));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** ai_analysis.period_key: "<Monday or YYYY-MM>|<accountId or all>", matching the account scope the page shows. */
export const periodKeyOf = (period: string, accountId?: string | null) => `${period}|${accountId || "all"}`;

export const validPeriod = (kind: PeriodKind, p: string) =>
  kind === "weekly" ? /^\d{4}-\d{2}-\d{2}$/.test(p) && weekStartOf(p) === p : /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

export const shiftMonth = (m: string, d: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7); };

/** The same slices the week and month review pages use. */
export function periodSlices<T extends { day: string }>(kind: PeriodKind, period: string, closed: T[]) {
  if (kind === "weekly") {
    const end = addDays(period, 6), prev = addDays(period, -7);
    return {
      current: closed.filter((t) => t.day >= period && t.day <= end), previous: closed.filter((t) => t.day >= prev && t.day < period), history: [] as { period: string; trades: T[] }[],
    };
  }
  const of = (m: string) => closed.filter((t) => t.day.startsWith(m));
  return {
    current: of(period), previous: of(shiftMonth(period, -1)),
    history: [-1, -2, -3, -4, -5].map((d) => shiftMonth(period, d)).map((m) => ({ period: m, trades: of(m) })),
  };
}

export const WEEKLY_ANSWER_LABELS: [string, string][] = [
  ["followedRules", "Did I follow my rules?"], ["overtraded", "Did I overtrade?"], ["forcedSetups", "Did I force setups?"], ["respectedRisk", "Did I respect risk?"],
  ["followedPlan", "Did I follow my trading plan?"], ["emotions", "What emotions appeared most often?"], ["lostDiscipline", "When did I lose discipline?"],
  ["triggers", "What triggered bad decisions?"], ["keepDoing", "What should I continue?"], ["stopDoing", "What should I stop?"], ["change", "What should I change?"],
  ["focusNextWeek", "What is my one focus for next week?"],
];
export const MONTHLY_ANSWER_LABELS: [string, string][] = [["biggestImprovement", "Biggest improvement (in your words)"], ["notes", "Notes"], ["focusNextMonth", "Focus for next month"]];

export interface PeriodPacketTrade extends PeriodTrade { seq: number; confidence: number | null; discipline: number | null; notesText: string }

export interface PeriodPacketInput {
  kind: PeriodKind;
  period: string;
  scopeLabel: string;
  currency: string;
  current: PeriodPacketTrade[];
  previous: PeriodPacketTrade[];
  /** periodReport(current, previous), the same numbers the page shows */
  report: PeriodReport;
  history: { period: string; trades: PeriodPacketTrade[] }[];
  answers: { question: string; answer: string }[];
  riskRules: RiskRules;
}

export interface PeriodPacket { text: string; caveats: string[]; tradeCount: number }

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const r2 = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);
const money = (v: number) => v.toFixed(2);
const pf = (v: number | null) => (v === null ? "n/a" : v === Infinity ? "no losing trades" : v.toFixed(2));

const statsLine = (s: Summary) =>
  `trades ${s.count} (${s.wins} wins, ${s.losses} losses, ${s.breakevens} breakeven), win rate ${pct(s.winRate)}, average ${r2(s.avgR)}, total ${r2(s.totalR)}, net P&L ${money(s.netPnl)}, profit factor ${pf(s.profitFactor)}`;
const groupLine = (g: GroupStat) => `${g.key}: n=${g.n}, win rate ${pct(g.winRate)}, average ${r2(g.avgR)}, total ${r2(g.totalR)}, net P&L ${money(g.netPnl)}, ${STRENGTH_LABEL[g.strength]}`;

const sampleWord = (n: number) => (n < 10 ? "an insufficient sample" : n < 30 ? "weak evidence" : n < 100 ? "moderate evidence at most" : "a large enough sample for clear effects");

/** Sample-size caveats the app attaches to every summary, independent of the model. */
export function periodCaveats(kind: PeriodKind, current: number, previous: number, groups: GroupStat[]): string[] {
  const unit = kind === "weekly" ? "week" : "month";
  const out: string[] = [];
  if (current < 10) out.push(`${current} closed trade${current === 1 ? "" : "s"} this ${unit}: ${sampleWord(current)}. Treat the summary as a description of what happened, not as patterns or an edge.`);
  else if (current < 30) out.push(`${current} closed trades this ${unit}: weak evidence. Differences between strategies, setups or sessions may be noise.`);
  const small = groups.filter((g) => g.n < 10).length;
  if (small && current >= 10) out.push(`${small} of the groups below have fewer than 10 trades; their numbers describe those trades only.`);
  if (kind === "monthly" && previous < 10) out.push(`The previous month has ${previous} closed trade${previous === 1 ? "" : "s"}, so the month-to-month comparison is weak.`);
  return out;
}

export function buildPeriodPacket(i: PeriodPacketInput): PeriodPacket {
  const unit = i.kind === "weekly" ? "week" : "month";
  const r = i.report;
  const closed = i.current.filter((t) => t.netPnl !== null);
  const g = (name: string, f: (t: PeriodPacketTrade) => string | null) => {
    const gs = groupStats(closed, f, r.summary.avgR);
    return { name, gs, lines: gs.map(groupLine) };
  };
  const groups = [g("Strategy", (t) => t.strategyName), g("Setup", (t) => t.setupName), g("Session", (t) => t.session), g("Symbol", (t) => t.symbol)];
  const caveats = periodCaveats(i.kind, closed.length, i.previous.filter((t) => t.netPnl !== null).length, groups.flatMap((x) => x.gs));

  const withNotes = closed.length <= 40;
  const tradeLines = [...closed].sort((a, b) => a.day.localeCompare(b.day) || a.seq - b.seq).map((t) => {
    const emo = [t.emotionBefore && `before ${t.emotionBefore}`, t.emotionDuring && `during ${t.emotionDuring}`, t.emotionAfter && `after ${t.emotionAfter}`].filter(Boolean).join(", ");
    const parts = [
      `#${t.seq} ${t.day} ${t.symbol} ${t.direction}`, t.strategyName ? `strategy ${t.strategyName}` : "no strategy", t.setupName ? `setup ${t.setupName}` : null, t.session ? `session ${t.session}` : null,
      t.setupQuality ? `grade ${t.setupQuality}` : null, `R ${t.rMultiple !== null ? t.rMultiple.toFixed(2) : "n/a"}`, `P&L ${t.netPnl !== null ? money(t.netPnl) : "n/a"}`,
      t.riskPct !== null ? `risk ${t.riskPct.toFixed(2)}%` : null, t.mistakes.length ? `mistakes ${t.mistakes.map((k) => MISTAKE_LABEL[k] ?? k).join("/")}` : "no mistakes",
      emo ? `emotions ${emo}` : null, t.followedPlan === null ? null : `followed plan ${t.followedPlan ? "yes" : "no"}`,
      t.confidence !== null ? `confidence ${t.confidence}` : null, t.discipline !== null ? `discipline ${t.discipline}` : null,
    ];
    const notes = withNotes && t.notesText.trim() ? ` | notes: ${t.notesText.replace(/\s+/g, " ").trim().slice(0, 280)}` : "";
    return parts.filter(Boolean).join(", ") + notes;
  });

  const ps = summarize(i.previous.filter((t) => t.netPnl !== null));
  const prevMistakes = new Map<string, number>();
  for (const t of i.previous) for (const k of t.mistakes) prevMistakes.set(k, (prevMistakes.get(k) ?? 0) + 1);
  const rules = i.riskRules;
  const adherence = [
    `Followed plan (your answer per trade): ${r.followedPlanPct === null ? "not answered" : `${Math.round(r.followedPlanPct * 100)}% of ${closed.filter((t) => t.followedPlan !== null).length} answered trades`}`,
    `Risk per trade: ${r.avgRiskPct === null ? "not recorded" : `average ${r.avgRiskPct.toFixed(2)}%, max ${r.maxRiskPct!.toFixed(2)}%`}${rules.maxRiskPct ? ` (your limit ${rules.maxRiskPct}%)` : ""}`,
    `Trading days: ${r.tradingDays}, most trades in one day: ${r.maxTradesInDay}${rules.maxTradesPerDay ? ` (your limit ${rules.maxTradesPerDay})` : ""}`,
    `Trades with at least one recorded mistake: ${closed.filter((t) => t.mistakes.length).length} of ${closed.length}`,
    ...(rules.minRr ? [`Your minimum planned reward:risk: 1:${rules.minRr}`] : []),
  ];

  const section = (tag: string, lines: string[]) => (lines.length ? `<${tag}>\n${lines.join("\n")}\n</${tag}>` : "");
  const text = [
    `Write the ${i.kind} summary for the ${periodLabel(i.kind, i.period)}. Account scope: ${i.scopeLabel}. Currency: ${i.currency}. Everything below comes from the app's database for this one trader.`,
    section("sample_size_caveats", caveats.length ? caveats : [`${closed.length} closed trades this ${unit}.`]),
    section("period_stats", [`This ${unit}: ${statsLine(r.summary)}`, ...(r.findings.length ? ["Findings the app already shows on the page:", ...r.findings.map((f) => `- ${f}`)] : [])]),
    ...groups.map((x) => section(`by_${x.name.toLowerCase()}`, x.lines.length ? x.lines : ["none recorded"])),
    section("mistakes", r.mistakes.length ? r.mistakes.map((m) => `${m.label} (${m.key}): ${m.count}x, ${m.costR.toFixed(2)}R realised on those trades${prevMistakes.has(m.key) ? `; previous ${unit}: ${prevMistakes.get(m.key)}x` : ""}`) : ["none recorded"]),
    section("emotions", r.emotions.length ? r.emotions.map((e) => `${e.emotion}: ${e.count}`) : ["none recorded"]),
    section("rule_adherence", adherence),
    section("trades", tradeLines.length ? tradeLines : ["no closed trades"]),
    section(`previous_${unit}`, [`Previous ${unit}: ${statsLine(ps)}`]),
    ...(i.kind === "monthly" ? [section("earlier_months", i.history.map((h) => { const s = summarize(h.trades.filter((t) => t.netPnl !== null)); const mk = h.trades.reduce((a, t) => a + t.mistakes.length, 0); return `${h.period}: ${statsLine(s)}, mistakes per trade ${s.count ? (mk / s.count).toFixed(2) : "n/a"}`; }))] : []),
    section("your_written_review", i.answers.length ? i.answers.map((a) => `[${a.question}]\n${a.answer.trim()}`) : ["The trader hasn't written their own review for this period yet."]),
  ].filter(Boolean).join("\n\n");
  return { text, caveats, tradeCount: closed.length };
}

export const periodLabel = (kind: PeriodKind, period: string) =>
  kind === "weekly" ? `week of ${period} (Monday ${period} to Sunday ${addDays(period, 6)})` : `month ${period}`;

/** Turns the model's answer into the stored summary: capped, chart claims downgraded (no images here), scrubbed. */
export function finalizePeriod(out: PeriodModelOutput, ctx: { kind: PeriodKind; period: string; caveats: string[]; basedOn: StoredPeriodSummary["basedOn"]; promptVersion: string }): StoredPeriodSummary {
  const pts = (xs: Point[]) => cleanPoints(xs, false, 5);
  const caveats = [...ctx.caveats];
  const aiCaveats: string[] = [];
  for (const c of out.caveats.map((x) => x.trim()).filter(Boolean)) if (!caveats.includes(c) && !aiCaveats.includes(c) && aiCaveats.length < 5) aiCaveats.push(c.slice(0, 300));
  const s: StoredPeriodSummary = {
    kind: ctx.kind, period: ctx.period,
    summary: out.summary.trim().slice(0, 1200),
    performance: pts(out.performance), process: pts(out.process), psychology: pts(out.psychology),
    keep: pts(out.keep), stop: pts(out.stop), change: pts(out.change),
    focus: { text: out.focus.text.trim().slice(0, 400), basis: "opinion" },
    comparison: ctx.kind === "monthly" ? pts(out.comparison) : [],
    caveats, aiCaveats, basedOn: ctx.basedOn, redactions: 0, promptVersion: ctx.promptVersion,
  };
  const scrubbed = scrubDeep(s).value;
  return { ...scrubbed, redactions: countRedactions(scrubbed) };
}
