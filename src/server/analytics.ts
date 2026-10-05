import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { dayOfWeek, ymd } from "@/domain/sessions";

export interface EnrichedTrade {
  id: string;
  seq: number;
  accountId: string;
  accountName: string;
  symbol: string;
  direction: "long" | "short";
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  entryPrice: number;
  initialStop: number | null;
  takeProfit: number | null;
  exitPrice: number | null;
  sizeLots: number | null;
  riskAmount: number | null;
  riskPct: number | null;
  netPnl: number | null;
  pnlPct: number | null;
  rMultiple: number | null;
  plannedRr: number | null;
  setupScore: number | null;
  commission: number;
  swap: number;
  session: string | null;
  timeframe: string | null;
  marketCondition: string | null;
  trend: string | null;
  htfBias: string | null;
  setupQuality: string | null;
  confluences: string[];
  strategyId: string | null;
  strategyName: string | null;
  setupId: string | null;
  setupName: string | null;
  mistakes: string[];
  mistakeCosts: Record<string, number | null>;
  emotionBefore: string | null;
  emotionDuring: string | null;
  emotionAfter: string | null;
  confidence: number | null;
  discipline: number | null;
  followedPlan: boolean | null;
  day: string; // YYYY-MM-DD in user tz (by close, or open if open)
  dow: number;
  hasImages: boolean;
  notesText: string;
}

export interface TradeFilter {
  accountId?: string;
  from?: string;
  to?: string;
  symbol?: string;
  strategyId?: string;
  setupId?: string;
  session?: string;
  direction?: string;
  timeframe?: string;
  emotion?: string;
  quality?: string;
  mistake?: string;
  dow?: string;
  status?: string;
  outcome?: string; // win | loss
  q?: string;
}

export const FILTER_KEYS: (keyof TradeFilter)[] = ["accountId", "from", "to", "symbol", "strategyId", "setupId", "session", "direction", "timeframe", "emotion", "quality", "mistake", "dow", "status", "outcome", "q"];

export function parseFilter(sp: Record<string, string | string[] | undefined>): TradeFilter {
  const f: TradeFilter = {};
  for (const k of FILTER_KEYS) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) f[k] = s.slice(0, 100);
  }
  return f;
}

export function loadTrades(userId: string, tz: string): EnrichedTrade[] {
  const rows = db.query.trades.findMany({
    where: eq(schema.trades.userId, userId),
    with: { strategy: true, setup: true, mistakes: true, emotions: true, psychology: true, notes: true, images: { columns: { id: true } } },
  }).sync();
  const accounts = new Map(db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)).all().map((a) => [a.id, a.name]));
  return rows
    .map((t) => {
      const em = (p: string) => t.emotions.find((e) => e.phase === p)?.emotion ?? null;
      const ref = t.closedAt ?? t.openedAt;
      const n = t.notes;
      return {
        id: t.id, seq: t.seq, accountId: t.accountId, accountName: accounts.get(t.accountId) ?? "", symbol: t.symbol, direction: t.direction, status: t.status,
        openedAt: t.openedAt, closedAt: t.closedAt, entryPrice: t.entryPrice, initialStop: t.initialStop, takeProfit: t.takeProfit, exitPrice: t.exitPrice,
        sizeLots: t.sizeLots, riskAmount: t.riskAmount, riskPct: t.riskPct, netPnl: t.status === "closed" ? t.netPnl : null, pnlPct: t.pnlPct, rMultiple: t.status === "closed" ? t.rMultiple : null,
        plannedRr: t.plannedRr, setupScore: t.setupScore, commission: t.commission, swap: t.swap, session: t.session, timeframe: t.timeframe, marketCondition: t.marketCondition,
        trend: t.trend, htfBias: t.htfBias, setupQuality: t.setupQuality, confluences: t.confluences.split(",").map((s) => s.trim()).filter(Boolean),
        strategyId: t.strategyId, strategyName: t.strategy?.name ?? null, setupId: t.setupId, setupName: t.setup?.name ?? null,
        mistakes: [...new Set(t.mistakes.map((m) => m.mistakeKey))],
        mistakeCosts: Object.fromEntries(t.mistakes.map((m) => [m.mistakeKey, m.costR])),
        emotionBefore: em("before"), emotionDuring: em("during"), emotionAfter: em("after"),
        confidence: t.psychology?.confidence ?? null, discipline: t.psychology?.discipline ?? null, followedPlan: t.psychology?.followedPlan ?? null,
        day: ymd(ref, tz), dow: dayOfWeek(t.openedAt, tz), hasImages: t.images.length > 0,
        notesText: n ? [n.why, n.observed, n.thesis, n.whatHappened, n.didWell, n.didPoorly, n.wouldChange, n.lesson].join(" ") : "",
      } satisfies EnrichedTrade;
    })
    .sort((a, b) => (b.closedAt ?? b.openedAt).getTime() - (a.closedAt ?? a.openedAt).getTime());
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Free-text search: symbols, strategies, setups, sessions, mistakes, emotions, notes, plus a few phrases. */
export function matchesQuery(t: EnrichedTrade, q: string, mistakeLabels: Record<string, string>) {
  const terms = q.toLowerCase().trim();
  if (!terms) return true;
  if (/a\+/.test(terms) && t.setupQuality !== "A+") return false;
  if (/moved (my )?stop/.test(terms)) return t.mistakes.includes("moved_stop");
  if (/biggest loss|largest loss/.test(terms)) return (t.netPnl ?? 0) < 0;
  if (/biggest win|largest win|best trade/.test(terms)) return (t.netPnl ?? 0) > 0;
  const m = MONTHS.findIndex((mm) => terms.includes(mm));
  if (m >= 0 && Number(t.day.slice(5, 7)) !== m + 1) return false;
  const rest = terms
    .replace(/a\+/g, " ")
    .replace(/\b(trades?|from|where|i|in|my|the|with|on)\b/g, " ")
    .replace(new RegExp(`\\b(${MONTHS.join("|")})\\b`, "g"), " ")
    .split(/\s+/)
    .filter(Boolean);
  const hay = [t.symbol, t.strategyName, t.setupName, t.session, t.timeframe, t.direction, t.setupQuality, t.marketCondition, t.emotionBefore, t.emotionDuring, t.emotionAfter, ...t.confluences, ...t.mistakes.map((k) => mistakeLabels[k] ?? k), ...t.mistakes, t.notesText]
    .filter(Boolean).join(" ").toLowerCase();
  return rest.every((w) => hay.includes(w));
}

export function applyFilter(trades: EnrichedTrade[], f: TradeFilter, mistakeLabels: Record<string, string> = {}) {
  let out = trades.filter((t) => {
    if (f.accountId && t.accountId !== f.accountId) return false;
    if (f.from && t.day < f.from) return false;
    if (f.to && t.day > f.to) return false;
    if (f.symbol && t.symbol !== f.symbol) return false;
    if (f.strategyId && t.strategyId !== f.strategyId) return false;
    if (f.setupId && t.setupId !== f.setupId) return false;
    if (f.session && t.session !== f.session) return false;
    if (f.direction && t.direction !== f.direction) return false;
    if (f.timeframe && t.timeframe !== f.timeframe) return false;
    if (f.emotion && ![t.emotionBefore, t.emotionDuring, t.emotionAfter].includes(f.emotion)) return false;
    if (f.quality && t.setupQuality !== f.quality) return false;
    if (f.mistake && !t.mistakes.includes(f.mistake)) return false;
    if (f.dow && String(t.dow) !== f.dow) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.outcome === "win" && !((t.netPnl ?? 0) > 0)) return false;
    if (f.outcome === "loss" && !((t.netPnl ?? 0) < 0)) return false;
    if (f.q && !matchesQuery(t, f.q, mistakeLabels)) return false;
    return true;
  });
  if (f.q && /biggest|largest|best trade/.test(f.q.toLowerCase())) {
    const asc = /loss/.test(f.q.toLowerCase());
    out = [...out].sort((a, b) => (asc ? (a.netPnl ?? 0) - (b.netPnl ?? 0) : (b.netPnl ?? 0) - (a.netPnl ?? 0)));
  }
  return out;
}

export function userAccounts(userId: string) {
  return db.select().from(schema.accounts).where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.isArchived, false))).all();
}

export function startingBalance(userId: string, accountId?: string) {
  return userAccounts(userId).filter((a) => !accountId || a.id === accountId).reduce((s, a) => s + a.startingBalance, 0);
}
