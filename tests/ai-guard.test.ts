import { describe, it, expect } from "vitest";
import { certaintyViolations, scrubCertainty, scrubDeep, REDACTION } from "@/domain/ai/guard";
import { fallbackParams, takeAiQuota, resetAiQuotaForTests, AiRateLimitError, describeAiError, AiNotConfiguredError } from "@/server/ai/client";
import { systemBlocks, SYSTEM_RULES } from "@/server/ai/prompts";

describe("certainty guard", () => {
  it.each([
    "This trade will win.",
    "The setup is going to work out nicely.",
    "Your position will hit TP before London closes.",
    "It will definitely win from here.",
    "This is a guaranteed winner.",
    "You can't lose with this entry.",
    "A risk-free entry at the retest.",
    "This is a sure thing.",
    "There is a 100% chance of success.",
    "Price is certain to reach the target.",
    "This one is going to win.",
  ])("flags %s", (s) => {
    expect(certaintyViolations(s)).toEqual([s]);
  });

  it.each([
    "This setup shares 5 of 6 characteristics with your historically successful setups.",
    "No trade is guaranteed, and history describes past trades, not this one.",
    "Past results don't guarantee future results.",
    "Nothing here is risk-free.",
    "Whether this trade will win is unknown.",
    "Trades like this won 64% of the time (n = 41, moderate evidence).",
    "You exited early on winning trades 27 times.",
    "It is not certain to reach the target; the screenshot doesn't show the higher timeframe.",
  ])("allows %s", (s) => {
    expect(certaintyViolations(s)).toEqual([]);
  });

  it("redacts only the offending sentence", () => {
    const r = scrubCertainty("Entry was at the AOI. This trade will win. Risk was 1%.");
    expect(r.changed).toBe(true);
    expect(r.text).toBe(`Entry was at the AOI. ${REDACTION} Risk was 1%.`);
  });

  it("scrubs every string in a structured output", () => {
    const { value, changed } = scrubDeep({ a: ["fine", "This trade will win."], b: { c: "guaranteed profit" }, n: 3 });
    expect(changed).toBe(true);
    expect(value).toEqual({ a: ["fine", REDACTION], b: { c: REDACTION }, n: 3 });
  });
});

describe("AI client helpers", () => {
  it("adds the refusal fallback only for models that support the default form", () => {
    expect(fallbackParams("claude-opus-5-5")).toEqual({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(fallbackParams("claude-haiku-4-5")).toEqual({});
  });

  it("limits AI requests per user", () => {
    resetAiQuotaForTests();
    for (let i = 0; i < 40; i++) takeAiQuota("u1", 1_000);
    expect(() => takeAiQuota("u1", 1_000)).toThrow(AiRateLimitError);
    expect(() => takeAiQuota("u2", 1_000)).not.toThrow();
    expect(() => takeAiQuota("u1", 1_000 + 10 * 60_000)).not.toThrow();
    resetAiQuotaForTests();
  });

  it("describes errors without leaking details", () => {
    expect(describeAiError(new AiNotConfiguredError())).toMatch(/ANTHROPIC_API_KEY/);
    expect(describeAiError(new Error("sk-ant-secret"))).toBe("The AI request failed.");
  });

  it("keeps the cached system prefix stable and free of per-request data", () => {
    const a = systemBlocks("feature A"), b = systemBlocks("feature B");
    expect(a[0]).toEqual(b[0]);
    expect(a[0].cache_control).toEqual({ type: "ephemeral" });
    expect(a[0].text.startsWith(SYSTEM_RULES)).toBe(true);
    expect(a[0].text).toContain("[set-and-forget]");
    expect(a[0].text).not.toMatch(/20\d\d-\d\d-\d\dT/);
  });
});
