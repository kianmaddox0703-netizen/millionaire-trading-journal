import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { config } from "../config";
import { newId } from "../ids";
import { decryptSecret, encryptSecret } from "../secrets";

/**
 * Whose Anthropic key the AI features use. Each user can save their own key inside the app (Settings → AI): it is
 * stored encrypted (src/server/secrets.ts), decrypted only on the server when a request is made for that user,
 * and never sent to the browser or logged. A user without a saved key falls back to ANTHROPIC_API_KEY from the
 * server environment, if one is set, so an installation can still be configured the old way.
 */

const KIND = "anthropic" as const;
const bind = (userId: string) => `${userId}:${KIND}`;

/** Anthropic keys look like sk-ant-api03-… (letters, digits, - and _). Anything else is almost certainly a paste mistake. */
export const ANTHROPIC_KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

export type AiKeySource = "own" | "server" | "none";

function ownRow(userId: string) {
  return db.select().from(schema.userSecrets).where(and(eq(schema.userSecrets.userId, userId), eq(schema.userSecrets.kind, KIND))).get();
}

/** The key to use for this user: their saved one, else the server's, else null. */
export function anthropicKeyFor(userId: string): string | null {
  const row = ownRow(userId);
  const own = row ? decryptSecret(row.ciphertext, bind(userId)) : null;
  if (own) return own;
  return config.anthropicKey() || null;
}

/** What Settings shows. Never includes the key itself, only its last four characters. */
export function aiKeyStatus(userId: string): { source: AiKeySource; hint: string | null; unreadable: boolean } {
  const row = ownRow(userId);
  const own = row ? decryptSecret(row.ciphertext, bind(userId)) : null;
  if (own) return { source: "own", hint: row!.hint || null, unreadable: false };
  return { source: config.anthropicKey() ? "server" : "none", hint: null, unreadable: !!row };
}

/** Pulls the usual paste decorations off a key (spaces, a trailing newline, wrapping quotes). */
export function cleanKeyInput(raw: string): string {
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function validateKeyShape(key: string): string | null {
  if (!key) return "Paste your Anthropic API key first.";
  if (/\s/.test(key)) return "That has spaces or line breaks in it. Paste just the key.";
  if (!key.startsWith("sk-ant-")) return "That doesn't look like an Anthropic key. They start with sk-ant-";
  if (!ANTHROPIC_KEY_SHAPE.test(key)) return "That key looks cut off or has extra characters. Copy it again from the Anthropic console.";
  return null;
}

/** Stores (or replaces) the user's key, encrypted. The caller has already validated and checked it. */
export function saveAnthropicKey(userId: string, key: string) {
  const ciphertext = encryptSecret(key, bind(userId));
  const set = { ciphertext, hint: key.slice(-4), updatedAt: new Date() };
  db.insert(schema.userSecrets).values({ id: newId(), userId, kind: KIND, ...set })
    .onConflictDoUpdate({ target: [schema.userSecrets.userId, schema.userSecrets.kind], set }).run();
}

export function removeAnthropicKey(userId: string): boolean {
  return db.delete(schema.userSecrets).where(and(eq(schema.userSecrets.userId, userId), eq(schema.userSecrets.kind, KIND))).run().changes > 0;
}
