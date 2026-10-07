import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

/**
 * Encryption for secrets the user saves inside the app (their Anthropic key).
 *
 * AES-256-GCM. Every value gets its own random IV, and the user id + kind are bound in as authenticated data, so a
 * ciphertext copied to another user's row (or another kind of secret) fails to decrypt instead of being used.
 *
 * The master key is APP_SECRET if set (any string; hashed to 32 bytes). Otherwise a random key is created once in
 * DATA_DIR/secret.key (mode 0600). That protects the database file on its own, for example a copy of journal.db or
 * a database export. It does not protect against someone who can read the whole server, because the app has to be
 * able to decrypt. Set APP_SECRET in the server environment to keep the master key out of DATA_DIR entirely.
 */

const FILE = () => path.join(dataDir(), "secret.key");
let cached: { source: string; key: Buffer } | null = null;

function masterKey(): Buffer {
  const env = process.env.APP_SECRET;
  if (env) {
    if (cached?.source !== `env:${env}`) cached = { source: `env:${env}`, key: crypto.createHash("sha256").update(env, "utf8").digest() };
    return cached.key;
  }
  const file = FILE();
  if (cached?.source === `file:${file}`) return cached.key;
  let hex: string;
  try {
    hex = fs.readFileSync(file, "utf8").trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code !== "EEXIST") throw e2; // another process created it first
    }
    hex = fs.readFileSync(file, "utf8").trim();
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("secret.key in the data folder is not a 64-character hex key. Restore it from a backup, or remove it and re-enter your saved keys.");
  cached = { source: `file:${file}`, key: Buffer.from(hex, "hex") };
  return cached.key;
}

const b64 = (b: Buffer) => b.toString("base64url");

/** v1.<iv>.<tag>.<ciphertext>. `bind` is authenticated but not stored, e.g. `${userId}:anthropic`. */
export function encryptSecret(plain: string, bind: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  c.setAAD(Buffer.from(bind, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
}

/** The plaintext, or null if the value was altered, bound to something else, or made with a different master key. */
export function decryptSecret(blob: string, bind: string): string | null {
  try {
    const [v, iv, tag, ct] = blob.split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(bind, "utf8"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
