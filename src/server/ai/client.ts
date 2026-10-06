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

/** A user-facing message for an API failure. Never includes the key or request bodies. */
export function describeAiError(e: unknown): string {
  if (e instanceof AiNotConfiguredError) return e.message;
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

/** The model answered but the answer couldn't be used (refusal, truncated, invalid structure). */
export class AiOutputError extends Error {}

/** Throws AiOutputError for stop reasons that mean the content can't be trusted as complete. */
export function assertUsableStop(message: { stop_reason: string | null }) {
  if (message.stop_reason === "refusal") throw new AiOutputError("The model declined to answer this request.");
  if (message.stop_reason === "max_tokens") throw new AiOutputError("The AI answer was cut off before it finished. Try again.");
}

export function usageOf(message: { usage?: { input_tokens?: number | null; output_tokens?: number | null } | null }) {
  return { inputTokens: message.usage?.input_tokens ?? null, outputTokens: message.usage?.output_tokens ?? null };
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
