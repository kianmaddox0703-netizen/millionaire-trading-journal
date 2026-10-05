import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { sha256, randomToken } from "./tokens";
import { eq, and, gt } from "drizzle-orm";
import { db, schema } from "./db";
import { config } from "./config";
export { sha256, randomToken };
import { newId } from "./ids";

const COOKIE = "mtj_session";
const SESSION_DAYS = 30;


export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
let _dummy: string | null = null;
/** A real bcrypt hash used when the user doesn't exist, so login timing doesn't reveal which emails exist. */
export const dummyHash = () => (_dummy ??= bcrypt.hashSync(randomToken(), 12));

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.insert(schema.sessions).values({ id: newId(), userId, tokenHash: sha256(token), expiresAt }).run();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure(),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).run();
  jar.delete(COOKIE);
}

export type SessionUser = { id: string; email: string; name: string; timezone: string; baseCurrency: string };

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, timezone: schema.users.timezone, baseCurrency: schema.users.baseCurrency })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .get();
  return row ?? null;
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}
