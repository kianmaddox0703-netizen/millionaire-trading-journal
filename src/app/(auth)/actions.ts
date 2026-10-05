"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { createSession, destroySession, dummyHash, hashPassword, verifyPassword } from "@/server/auth";
import { newId } from "@/server/ids";
import { bootstrapUser } from "@/server/trades";
import { config } from "@/server/config";

export type AuthState = { error?: string } | undefined;

const attempts = new Map<string, { n: number; until: number }>();
function limited(key: string) {
  const a = attempts.get(key);
  return a && a.n >= 8 && a.until > Date.now();
}
function fail(key: string) {
  const a = attempts.get(key);
  const n = a && a.until > Date.now() ? a.n + 1 : 1;
  attempts.set(key, { n, until: Date.now() + 15 * 60_000 });
}

const creds = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

export async function login(_: AuthState, fd: FormData): Promise<AuthState> {
  const parsed = creds.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const { email, password } = parsed.data;
  if (limited(email)) return { error: "Too many attempts. Try again in 15 minutes." };
  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  // Always run bcrypt to keep timing similar whether or not the user exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !ok) {
    fail(email);
    return { error: "Email or password is incorrect." };
  }
  attempts.delete(email);
  await createSession(user.id);
  redirect("/dashboard");
}

const reg = z.object({
  name: z.string().trim().max(80).default(""),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  timezone: z.string().max(60).default("UTC"),
});

export async function register(_: AuthState, fd: FormData): Promise<AuthState> {
  if (!config.allowRegistration()) return { error: "Registration is disabled on this server." };
  const parsed = reg.safeParse({ name: fd.get("name") ?? "", email: fd.get("email"), password: fd.get("password"), timezone: fd.get("timezone") || "UTC" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { name, email, password } = parsed.data;
  let tz = parsed.data.timezone;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = "UTC"; }
  if (db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get())
    return { error: "An account with this email already exists." };
  const id = newId();
  db.insert(schema.users).values({ id, email, name, passwordHash: await hashPassword(password), timezone: tz }).run();
  bootstrapUser(id);
  await createSession(id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
