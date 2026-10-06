import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

/**
 * The one place the app talks to the Anthropic API.
 *
 * - The key comes only from ANTHROPIC_API_KEY on the server and is never logged or sent to the browser.
 * - Without a key every AI feature reports "not configured"; nothing is simulated.
 * - Tests inject a labelled test double with setAiClientForTests(); production never does.
 */

/** The parts of the SDK client the app uses. Narrow on purpose so a test double can stand in. */
export type AiClient = Pick<Anthropic, "beta">;

let override: AiClient | null = null;
let cached: { key: string; client: Anthropic } | null = null;

export class AiNotConfiguredError extends Error {
  constructor() { super("AI is not configured. Add ANTHROPIC_API_KEY on the server to enable it."); }
}

export function aiConfigured() {
  return override !== null || config.anthropicKey() !== "";
}

export function aiClient(): AiClient {
  if (override) return override;
  const key = config.anthropicKey();
  if (!key) throw new AiNotConfiguredError();
  if (!cached || cached.key !== key) {
    // baseURL is explicit so a stray ANTHROPIC_BASE_URL in the host environment can't redirect the user's key.
    cached = { key, client: new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com", maxRetries: 2, timeout: 180_000 }) };
  }
  return cached.client;
}

/** Test seam. Pass null to restore the real client. */
export function setAiClientForTests(client: AiClient | null) {
  override = client;
}

export function aiModel() {
  return config.anthropicModel();
}

// Models that accept the server-side refusal fallback in its "default" form. On a safety-classifier
// decline the API re-runs the request on a suitable model inside the same call instead of failing.
const DEFAULT_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** Extra request fields for the refusal fallback. Empty for models that don't support it. */
export function fallbackParams(model: string): { betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: "default" } {
  return DEFAULT_FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

/**
 * A 403/407 without Anthropic's JSON error body came from a proxy or firewall that doesn't allow the host,
 * not from the API. Without this check a blocked host would be reported as a key or model problem.
 */
function blockedOnTheWay(e: unknown): e is InstanceType<typeof Anthropic.APIError> {
  if (!(e instanceof Anthropic.APIError) || (e.status !== 403 && e.status !== 407)) return false;
  const body = e.error as { type?: unknown } | undefined;
  return !body || typeof body !== "object" || body.type !== "error";
}

// Models that accept output_config.effort: Opus 4.5+, Sonnet 4.6+ and the Claude 5 family. Haiku 4.5 and
// Sonnet 4.5 reject it, so a cheaper ANTHROPIC_MODEL still works (at that model's fixed default).
const EFFORT_MODELS = /^claude-(opus-4-[5-9]|sonnet-4-[6-9]|(opus|sonnet|fable|mythos)-[5-9])/;

/** The effort setting for this model: medium where supported, nothing otherwise. */
export function effortParams(model: string): { effort?: "medium" } {
  return EFFORT_MODELS.test(model) ? { effort: "medium" } : {};
}

/** A user-facing message for an API failure. Never includes the key or request bodies. */
export function describeAiError(e: unknown): string {
  if (e instanceof AiNotConfiguredError) return e.message;
  if (blockedOnTheWay(e)) return `The request was blocked before it reached the Anthropic API (HTTP ${e.status}, with no error message from Anthropic). This usually means the server's network doesn't allow api.anthropic.com.`;
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The Anthropic API key doesn't have access to this model. Check ANTHROPIC_MODEL.";
  if (e instanceof Anthropic.NotFoundError) return `The model "${aiModel()}" wasn't found. Check ANTHROPIC_MODEL.`;
  if (e instanceof Anthropic.RateLimitError) return "The Anthropic API rate limit was reached. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check the server's network access.";
  if (e instanceof Anthropic.APIError) return `The Anthropic API returned an error (${e.status ?? "unknown"}). Try again shortly.`;
  if (e instanceof AiOutputError || e instanceof AiRateLimitError) return e.message;
  return "The AI request failed.";
}

/** A stable, minifier-proof category for logs and tests. Never contains the key or any payload. */
export function aiErrorKind(e: unknown): string {
  if (e instanceof AiNotConfiguredError) return "not_configured";
  if (e instanceof AiRateLimitError) return "app_rate_limit";
  if (e instanceof AiOutputError) return "unusable_output";
  if (blockedOnTheWay(e)) return "blocked_on_network";
  if (e instanceof Anthropic.AuthenticationError) return "auth_rejected";
  if (e instanceof Anthropic.PermissionDeniedError) return "permission_denied";
  if (e instanceof Anthropic.NotFoundError) return "model_not_found";
  if (e instanceof Anthropic.RateLimitError) return "api_rate_limit";
  if (e instanceof Anthropic.BadRequestError) return "bad_request";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (e instanceof Anthropic.APIConnectionError) return "connection";
  if (e instanceof Anthropic.APIError) return `api_${e.status ?? "error"}`;
  return "unexpected";
}

/**
 * One log line per AI failure: feature, stable kind, HTTP status and the API request id (both safe to log).
 * Never logs keys, request bodies or API payloads. Unexpected errors (app bugs) add the first 200 characters
 * of their message so they can be fixed.
 */
export function logAiFailure(where: string, e: unknown) {
  const kind = aiErrorKind(e);
  const api = e instanceof Anthropic.APIError ? `${e.status ? ` status=${e.status}` : ""}${e.requestID ? ` request_id=${e.requestID}` : ""}` : "";
  if (kind === "unexpected") console.error(`[ai:${where}] failed: unexpected${e instanceof Error ? `: ${e.message.slice(0, 200)}` : ""}`);
  else console.warn(`[ai:${where}] failed: ${kind}${api}`);
}

/** The model answered but the answer couldn't be used (refusal, truncated, invalid structure). */
export class AiOutputError extends Error {}

/** Throws AiOutputError for stop reasons that mean the content can't be trusted as complete. */
export function assertUsableStop(message: { stop_reason: string | null }) {
  if (message.stop_reason === "refusal") throw new AiOutputError("The model declined to answer this request.");
  if (message.stop_reason === "max_tokens") throw new AiOutputError("The AI answer was cut off before it finished. Try again.");
}

type Usage = { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };

/** Token counts to store. Input includes the cached system prefix (written or read), so it is the whole prompt. */
export function usageOf(message: { usage?: Usage | null }) {
  const u = message.usage;
  if (!u) return { inputTokens: null, outputTokens: null };
  const parts = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens];
  return { inputTokens: parts.every((x) => x == null) ? null : parts.reduce<number>((a, x) => a + (x ?? 0), 0), outputTokens: u.output_tokens ?? null };
}

// ───────────── per-user rate limit (cost guard) ─────────────

const WINDOW_MS = 10 * 60_000;
const LIMIT = 40;
const hits = new Map<string, number[]>();

export class AiRateLimitError extends Error {
  constructor() { super("Too many AI requests in the last 10 minutes. Try again shortly."); }
}

/** Sliding-window limit per user: 40 AI requests per 10 minutes. Throws AiRateLimitError when exceeded. */
export function takeAiQuota(userId: string, now = Date.now()) {
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(userId, recent);
    throw new AiRateLimitError();
  }
  recent.push(now);
  hits.set(userId, recent);
}

export function resetAiQuotaForTests() {
  hits.clear();
}
