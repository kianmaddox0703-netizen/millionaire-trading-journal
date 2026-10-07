import Anthropic from "@anthropic-ai/sdk";
import { aiModel, describeAiError, logAiFailure } from "./client";

/**
 * Asks Anthropic whether a key is accepted, before it is saved. It reads the model's details (GET /v1/models/<id>),
 * which makes no model call and costs nothing. It can't see the account's credit balance; that only shows when the AI is used.
 */
export type KeyCheck =
  | { state: "accepted"; note?: string }
  | { state: "rejected"; message: string }
  | { state: "unverified"; message: string };

async function realCheck(key: string): Promise<KeyCheck> {
  try {
    const client = new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com", maxRetries: 0, timeout: 15_000 });
    await client.models.retrieve(aiModel());
    return { state: "accepted" };
  } catch (e) {
    logAiFailure("key check", e);
    if (e instanceof Anthropic.AuthenticationError) return { state: "rejected", message: "Anthropic didn't accept that key. Check you copied all of it, and that it hasn't been deleted in the Anthropic console." };
    if (e instanceof Anthropic.NotFoundError) return { state: "accepted", note: `The key works, but the model "${aiModel()}" wasn't found for your account.` };
    return { state: "unverified", message: describeAiError(e) };
  }
}

let checker: (key: string) => Promise<KeyCheck> = realCheck;

export function checkAnthropicKey(key: string): Promise<KeyCheck> {
  return checker(key);
}

/** Test seam: lets tests answer the check without network access. Pass null to restore the real one. */
export function setKeyCheckerForTests(fn: ((key: string) => Promise<KeyCheck>) | null) {
  checker = fn ?? realCheck;
}
