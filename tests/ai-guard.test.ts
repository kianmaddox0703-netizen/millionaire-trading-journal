import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { certaintyGate, certaintyViolations, scrubCertainty, scrubDeep, REDACTION } from "@/domain/ai/guard";
import { effortParams, fallbackParams, takeAiQuota, resetAiQuotaForTests, AiRateLimitError, describeAiError, AiNotConfiguredError, aiErrorKind, logAiFailure } from "@/server/ai/client";
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
    "There is no doubt this setup will work.",
    "Without question, this trade will hit your target.",
    "This is not financial advice, but this trade will win.",
    "If you stick to the plan, this trade will win.",
    "No question about it: your position will reach TP.",
    "Make no mistake this trade will hit your target.",
    "I have never been more confident this trade will win.",
    "No matter what happens this trade will win.",
    "Don't worry this trade will win.",
    "Don\u2019t worry, this trade will win.",
    "No need to worry this setup will work.",
    "Never seen a cleaner setup \u2014 this trade will win.",
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
    "There is no guarantee this setup will work.",
    "We can't know if this trade will win.",
    "You can\u2019t know whether this trade will win.",
  ])("allows %s", (s) => {
    expect(certaintyViolations(s)).toEqual([]);
  });

  it("holds streamed text until each sentence is complete and releases it scrubbed", () => {
    const g = certaintyGate();
    const out = [g.push("Your London trades average +0.4R (n = 31, moderate"), g.push(" evidence). This trade will"), g.push(" win. Keep"), g.push(" the 1% risk.")];
    expect(out[0]).toBe("");
    expect(out.join("")).not.toMatch(/will win/);
    expect(out.join("") + g.flush()).toBe(`Your London trades average +0.4R (n = 31, moderate evidence). ${REDACTION} Keep the 1% risk.`);
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

  it("sends effort only to models that accept it", () => {
    for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-4-5", "claude-sonnet-4-6"]) expect(effortParams(m)).toEqual({ effort: "medium" });
    for (const m of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5"]) expect(effortParams(m)).toEqual({});
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

  it("logs a stable kind, status and request id, never the key or the API payload", () => {
    const headers = new Headers({ "request-id": "req_test_123" });
    const auth = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key sk-ant-SHOULD-NOT-APPEAR" } }, undefined, headers);
    expect(aiErrorKind(auth)).toBe("auth_rejected");
    expect(aiErrorKind(new Anthropic.APIConnectionError({ message: "socket hang up" }))).toBe("connection");
    expect(aiErrorKind(new AiRateLimitError())).toBe("app_rate_limit");
    expect(aiErrorKind(new Error("boom"))).toBe("unexpected");
    // a proxy refusing the host answers 403 with plain text; the API's own 403 has a JSON error body
    const proxy = Anthropic.APIError.generate(403, undefined, "Host not in allowlist: api.anthropic.com", new Headers());
    expect(aiErrorKind(proxy)).toBe("blocked_on_network");
    expect(describeAiError(proxy)).toMatch(/blocked before it reached the Anthropic API.*api\.anthropic\.com/);
    const denied = Anthropic.APIError.generate(403, { type: "error", error: { type: "permission_error", message: "no access" } }, undefined, new Headers());
    expect(aiErrorKind(denied)).toBe("permission_denied");
    expect(describeAiError(denied)).toMatch(/ANTHROPIC_MODEL/);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logAiFailure("trade review", auth);
    expect(warn).toHaveBeenCalledWith("[ai:trade review] failed: auth_rejected status=401 request_id=req_test_123");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-ant");
    warn.mockRestore();
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
