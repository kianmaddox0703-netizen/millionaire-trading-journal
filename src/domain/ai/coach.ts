/**
 * Pure helpers for the AI coach: the event protocol shared by server and browser, the
 * suggested questions, tool status labels and a small safe renderer model for answers.
 *
 * Answers are rendered from this tree (no HTML is ever injected), so whatever the model
 * writes can only become paragraphs, lists, bold/italic text, inline code, basis badges,
 * links to the trader's own trades and plain https links.
 */
import type { Basis } from "./guard";
import { KB_SOURCE_URLS } from "@/domain/kb/fxalexg";

export const MAX_MESSAGE_CHARS = 2000;

/** NDJSON events sent by POST /api/ai/coach, one JSON object per line. */
export type CoachEvent =
  | { type: "conversation"; id: string }
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "replace"; text: string }
  | { type: "done"; messageId: string; links: Record<string, string>; tools: string[] }
  | { type: "error"; message: string };

/** The spec's questions, offered as one-click starters. */
export const SUGGESTED_QUESTIONS = [
  "Why am I losing money?",
  "What setups make me the most money?",
  "What mistake am I repeating?",
  "Show me my best 10 trades.",
  "What should I focus on next week?",
  "What conditions should I avoid?",
] as const;

export const tradeQuestion = (seq: number) => `Is trade #${seq} consistent with my plan? Compare it to my historical winners.`;

/** A short single-line title for a conversation from its first question. */
export function conversationTitle(message: string) {
  const line = message.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

// ───────────── tool status labels ─────────────

const DIM_LABEL: Record<string, string> = {
  symbol: "symbol", session: "session", strategy: "strategy", setup: "setup", quality: "setup grade", timeframe: "timeframe",
  direction: "direction", day: "weekday", emotion: "emotion", trend_alignment: "trend alignment", planned_rr: "planned R:R", month: "month",
};

/** Friendly progress line for a tool call, shown while the coach is looking things up. */
export function toolStatus(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const seq = typeof i.seq === "number" ? `#${i.seq}` : "the trade";
  switch (name) {
    case "get_performance": return "Checking your performance…";
    case "breakdown": return `Breaking down your results by ${DIM_LABEL[String(i.dimension)] ?? "condition"}…`;
    case "list_trades": return "Looking at your trades…";
    case "get_trade": return `Reading trade ${seq}…`;
    case "compare_to_history": return `Comparing ${seq} with your past trades…`;
    case "find_edges": return "Looking for your strongest and weakest conditions…";
    case "mistakes": return "Reviewing your mistakes…";
    case "psychology": return "Checking psychology patterns…";
    case "strategies": return "Reading your strategies and rules…";
    case "reviews": return `Reading your ${i.kind === "monthly" ? "monthly" : "weekly"} reviews…`;
    case "risk_rules": return "Checking your risk rules…";
    case "search_methodology": return "Searching the FXAlexG knowledge base…";
    default: return "Looking at your journal…";
  }
}

/** Short names for the data a stored answer looked up, shown under the answer. */
export const TOOL_LABEL: Record<string, string> = {
  get_performance: "performance", breakdown: "breakdowns", list_trades: "trade lists", get_trade: "trade details", compare_to_history: "history comparison",
  find_edges: "edge finder", mistakes: "mistakes", psychology: "psychology", strategies: "strategies and rules", reviews: "reviews",
  risk_rules: "risk rules", search_methodology: "FXAlexG knowledge base",
};

export const toolList = (csv: string | string[]) =>
  (Array.isArray(csv) ? csv : csv.split(",")).filter(Boolean).map((t) => TOOL_LABEL[t] ?? t).join(", ");

// ───────────── NDJSON reading (browser) ─────────────

/** Splits a byte stream of NDJSON into parsed events; keeps a partial trailing line until it completes. */
export class NdjsonReader {
  private buf = "";
  push(chunk: string): CoachEvent[] {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    return lines.flatMap((l) => parseEvent(l));
  }
  flush(): CoachEvent[] {
    const rest = this.buf;
    this.buf = "";
    return parseEvent(rest);
  }
}

function parseEvent(line: string): CoachEvent[] {
  if (!line.trim()) return [];
  try {
    const v = JSON.parse(line) as { type?: unknown };
    return v && typeof v.type === "string" ? [v as CoachEvent] : [];
  } catch {
    return [];
  }
}

// ───────────── answer rendering model ─────────────

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "basis"; basis: Basis }
  | { t: "trade"; seq: number }
  | { t: "link"; v: string; href: string }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; v: string };

const BASIS_TAG: Record<string, Basis> = { data: "data", history: "history", chart: "chart", inference: "inference", opinion: "opinion" };

// Order matters: code first so nothing inside backticks is interpreted.
const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|\[(data|history|chart|inference|opinion)\]|\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(?<![\w&#])#(\d{1,6})\b|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/gi;

export function parseInline(s: string, nested = false): Inline[] {
  const out: Inline[] = [];
  const text = (v: string) => { if (!v) return; const last = out[out.length - 1]; if (last?.t === "text") last.v += v; else out.push({ t: "text", v }); };
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    const i = m.index ?? 0;
    text(s.slice(at, i));
    at = i + m[0].length;
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push(nested ? { t: "text", v: m[2] } : { t: "strong", c: parseInline(m[2], true) });
    else if (m[3] !== undefined) out.push({ t: "basis", basis: BASIS_TAG[m[3].toLowerCase()] });
    // Only the knowledge base's own sources become links. Any other URL stays visible as plain text, so text
    // that reached the model from a screenshot or note can't turn into a link that carries data elsewhere.
    else if (m[5] !== undefined) {
      if (KB_SOURCE_URLS.includes(m[5])) out.push({ t: "link", v: m[4], href: m[5] });
      else text(`${m[4]} (${m[5]})`);
    }
    else if (m[6] !== undefined) out.push({ t: "trade", seq: Number(m[6]) });
    else if (m[7] !== undefined) out.push(nested ? { t: "text", v: m[7] } : { t: "em", c: parseInline(m[7], true) });
  }
  text(s.slice(at));
  return out;
}

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/** Parses an answer into blocks. Unknown markdown degrades to plain text, never to markup. */
export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; start: number; items: string[] } | null = null;
  let table: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const c: Inline[] = [];
    para.forEach((l, i) => { if (i) c.push({ t: "br" }); c.push(...parseInline(l)); });
    blocks.push({ t: "p", c });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((x) => parseInline(x));
    blocks.push(list.kind === "ul" ? { t: "ul", items } : { t: "ol", start: list.start, items });
    list = null;
  };
  const flushTable = () => { if (table.length) blocks.push({ t: "pre", v: table.join("\n") }); table = []; };
  const flush = () => { flushPara(); flushList(); flushTable(); };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flush(); continue; }
    if (/^\s*\|/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
    flushTable();
    if (RULE.test(line)) { flush(); continue; }
    const h = HEADING.exec(line);
    if (h) { flush(); blocks.push({ t: "h", c: parseInline(h[1]) }); continue; }
    const ul = UL.exec(line), ol = OL.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list && list.kind !== kind && !/^\s{2,}/.test(line)) flushList();
      if (!list) list = { kind, start: ol ? Number(ol[1]) : 1, items: [] };
      list.items.push(ul ? ul[1] : ol![2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/** Trade numbers (#123) referenced in a text, outside inline code. */
export function tradeRefs(text: string): number[] {
  const seqs = new Set<number>();
  const walk = (xs: Inline[]) => { for (const x of xs) { if (x.t === "trade") seqs.add(x.seq); else if (x.t === "strong" || x.t === "em") walk(x.c); } };
  for (const b of parseAnswer(text)) {
    if (b.t === "p" || b.t === "h") walk(b.c);
    else if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
  }
  return [...seqs].sort((a, b) => a - b);
}
