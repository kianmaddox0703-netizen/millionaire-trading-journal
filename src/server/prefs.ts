import "server-only";
import { cookies } from "next/headers";
import { userAccounts } from "./analytics";

export const ACCOUNT_COOKIE = "mtj_acct";

/** Selected account id, or undefined for "All accounts (combined)". */
export async function selectedAccount(userId: string): Promise<string | undefined> {
  const v = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  if (!v || v === "all") return undefined;
  return userAccounts(userId).some((a) => a.id === v) ? v : undefined;
}
