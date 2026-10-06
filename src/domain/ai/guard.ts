/**
 * Guardrails applied to every AI output before it is stored or shown.
 *
 * The spec's hard rule: the AI must never say a trade will win. Prompts tell the model this,
 * and this module enforces it after the fact, because a prompt alone is not a guarantee.
 */

/** Where a statement comes from. Every AI claim carries one of these so the user can weigh it. */
export const BASIS = ["data", "history", "chart", "inference", "opinion"] as const;
export type Basis = (typeof BASIS)[number];

export const BASIS_LABEL: Record<Basis, string> = {
  data: "Recorded data",
  history: "Historical evidence",
  chart: "Visible on chart",
  inference: "Inference",
  opinion: "Opinion",
};

export const BASIS_HELP: Record<Basis, string> = {
  data: "Taken directly from what you recorded (fields, notes, checklists) or from market data the app fetched for the trade.",
  history: "Computed from your own past trades. Describes how similar trades went, not how this one will.",
  chart: "Directly visible in the screenshot.",
  inference: "A likely interpretation that isn't directly shown.",
  opinion: "A judgement call. Weigh it against your own plan.",
};

// A negation or open question right before the phrase, at most two words away and in the same clause
// ("no guarantee", "isn't risk-free", "nothing here is risk-free", "whether this trade will win is unknown"),
// makes it fine. Further away it usually governs something else ("never been more confident this will win").
const NEGATION = /\b(no|not|never|nothing|none|cannot|can't|cant|isn't|isnt|aren't|arent|doesn't|doesnt|don't|dont|won't|wont|without|neither|nor|whether)\b(?:\s+[^\s.!?]+){0,2}\s*$/i;
// Phrases that contain a negation word but strengthen, reassure or disclaim rather than negate:
// "no doubt this will win", "without question", "make no mistake", "no matter what", "don't worry",
// "not financial advice, but ...".
const NOT_A_NEGATION = /\b(no|without)\s+(a\s+|any\s+)?(doubt|question)s?\b|\bno\s+(mistake|matter)\b|\b(don't|dont|do not|no need to|not to)\s+worry\b|\bnot\s+(financial|investment|trading)\s+advice\b/gi;
// A clause break ends a negation's reach: "This is not advice, but this trade will win."
const CLAUSE_BREAK = /[,;:()\u2013\u2014]|\s-\s|\b(but|however|yet|still|though|although)\b/gi;

function negated(prefix: string) {
  const p = prefix.replace(/[\u2018\u2019]/g, "'").replace(NOT_A_NEGATION, " ");
  let start = 0;
  for (const m of p.matchAll(CLAUSE_BREAK)) start = m.index + m[0].length;
  return NEGATION.test(p.slice(start));
}

interface Rule { re: RegExp; negatable: boolean }

const RULES: Rule[] = [
  // "this trade will win", "the setup is going to work", "your position will hit TP"
  { re: /\b(this|the|that|your)\s+(trade|setup|position|entry|idea)s?\s+(will|is going to|is gonna|shall)\s+(definitely\s+|certainly\s+|surely\s+)?(win|work|succeed|profit|pay off|hit|reach|be (a )?(winner|winning|profitable|successful))\b/i, negatable: true },
  // "will definitely win", "will surely hit the target"
  { re: /\bwill\s+(definitely|certainly|surely|undoubtedly|absolutely|100%)\s+(win|work|succeed|profit|hit|reach|be (a )?(winner|profitable))\b/i, negatable: false },
  // "guaranteed", "guarantees a win" (but "no guarantee" is fine)
  { re: /\bguarantee(d|s)?\b/i, negatable: true },
  // "you can't lose", "cannot fail"
  { re: /\b(can't|cannot|cant|won't|wont)\s+(lose|fail|go wrong)\b/i, negatable: false },
  { re: /\brisk[- ]free\b/i, negatable: true },
  { re: /\b(sure|certain|guaranteed|safe)\s+(win|winner|thing|profit|bet|trade)\b/i, negatable: true },
  { re: /\b100\s?%\s+(win|winning|chance|certain|sure|probability|success)/i, negatable: true },
  { re: /\b(certain|sure|bound|destined)\s+to\s+(win|work|succeed|profit|hit|reach)\b/i, negatable: true },
  { re: /\b(will|going to)\s+win\b/i, negatable: true },
];

function sentences(text: string) {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** Sentences that state certainty about a trade's outcome. Empty when the text is clean. */
export function certaintyViolations(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    // a match that sits inside an already-negated one ("will win" in "can't know if this trade will win")
    // is covered by that negation
    const negatedSpans: [number, number][] = [];
    for (const r of RULES) {
      const m = r.re.exec(s);
      if (!m) continue;
      const end = m.index + m[0].length;
      if (negatedSpans.some(([a, b]) => m.index >= a && end <= b)) continue;
      if (r.negatable && negated(s.slice(0, m.index))) { negatedSpans.push([m.index, end]); continue; }
      out.push(s);
      break;
    }
  }
  return out;
}

export const REDACTION = "[Removed: a statement of certainty about an outcome. The journal describes evidence; it can't predict results.]";

/** Replaces violating sentences with a visible redaction note. */
export function scrubCertainty(text: string): { text: string; changed: boolean } {
  const bad = certaintyViolations(text);
  if (!bad.length) return { text, changed: false };
  let out = text;
  for (const s of bad) out = out.split(s).join(REDACTION);
  return { text: out, changed: true };
}

/**
 * The certainty guard for streamed text: each sentence is held back until it is complete, then released
 * already scrubbed, so a forbidden sentence never reaches the screen, even briefly.
 */
export function certaintyGate() {
  let pending = "";
  const take = (n: number) => {
    if (n <= 0) return "";
    const chunk = pending.slice(0, n);
    pending = pending.slice(n);
    return scrubCertainty(chunk).text;
  };
  return {
    /** Adds streamed text; returns the complete sentences that are ready to show. */
    push(text: string) {
      pending += text;
      let end = 0;
      for (const m of pending.matchAll(/[.!?]+["')\]]*\s+|\n+/g)) end = m.index + m[0].length;
      return take(end);
    },
    /** Releases whatever is left at the end of the stream. */
    flush() {
      return take(pending.length);
    },
  };
}

/** Every string inside a JSON-like value, for checking structured outputs. */
export function collectStrings(v: unknown, acc: string[] = []): string[] {
  if (typeof v === "string") acc.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, acc);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, acc);
  return acc;
}

/** Applies scrubCertainty to every string in a structured output. Returns a new value. */
export function scrubDeep<T>(v: T): { value: T; changed: boolean } {
  let changed = false;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") { const r = scrubCertainty(x); changed ||= r.changed; return r.text; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  const value = walk(v) as T;
  return { value, changed };
}
