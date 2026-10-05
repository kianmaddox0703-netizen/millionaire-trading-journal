"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { ACCOUNT_COOKIE } from "@/server/prefs";
import { userAccounts } from "@/server/analytics";
import { config } from "@/server/config";

export async function selectAccount(id: string) {
  const u = await requireUser();
  const value = id === "all" || userAccounts(u.id).some((a) => a.id === id) ? id : "all";
  (await cookies()).set(ACCOUNT_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure(), path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
