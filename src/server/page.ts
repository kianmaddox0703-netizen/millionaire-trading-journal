import "server-only";
import { requireUser } from "./auth";
import { loadTrades, startingBalance, userAccounts, type EnrichedTrade } from "./analytics";
import { selectedAccount } from "./prefs";

/** Everything most pages need: the user, their selected account scope and their trades in that scope. */
export async function pageContext() {
  const user = await requireUser();
  const accountId = await selectedAccount(user.id);
  const accounts = userAccounts(user.id);
  const all = loadTrades(user.id, user.timezone);
  const trades: EnrichedTrade[] = accountId ? all.filter((t) => t.accountId === accountId) : all.filter((t) => accounts.some((a) => a.id === t.accountId));
  const start = startingBalance(user.id, accountId);
  const currency = accountId ? accounts.find((a) => a.id === accountId)?.currency ?? "USD" : user.baseCurrency;
  return { user, tz: user.timezone, accountId, accounts, trades, closed: trades.filter((t) => t.status === "closed"), start, currency };
}
