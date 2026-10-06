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
  data: "Your records",
  history: "Historical evidence",
  chart: "Visible on chart",
  inference: "Inference",
  opinion: "Opinion",
};

export const BASIS_HELP: Record<Basis, string> = {
  data: "Taken directly from fields, notes or checklists you recorded.",
  history: "Computed from your own past trades. Describes how similar trades went, not how this one will.",
  chart: "Directly visible in the screenshot.",
  inference: "A likely interpretation that isn't directly shown.",
  opinion: "A judgement call. Weigh it against your own plan.",
};

// A negation or open question shortly before the phrase ("no guarantee", "isn't risk-free",
// "whether it will win is unknown") makes it fine.
const NEGATION = /\b(no|not|never|nothing|none|cannot|can't|cant|isn't|isnt|aren't|arent|doesn't|doesnt|don't|dont|won't|wont|without|neither|nor|whether|if)\b[^.!?\n]{0,40}$/i;

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
    for (const r of RULES) {
      const m = r.re.exec(s);
      if (!m) continue;
      if (r.negatable && NEGATION.test(s.slice(0, m.index))) continue;
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
