import { after } from "next/server";
import { refreshContextForTrades } from "./marketdata/context";
import { claimAutoReviews, runClaimedReviews } from "./ai/review";

export type SaveOrigin = "manual" | "import" | "mt5_bridge";

/**
 * Work that follows a trade save without delaying the response: automatic market context
 * (when a market-data provider is configured) and the one-time AI review of newly closed
 * trades (when an AI key is configured). Both are best effort; a failure is recorded on the
 * trade, never thrown at the user.
 */
export function afterTradesSaved(userId: string, tradeIds: string[], origin: SaveOrigin) {
  const ids = [...new Set(tradeIds)];
  if (!ids.length) return;
  // claimed now, so the trade page shows "being written" while the market context is still fetched first
  const claimed = claimAutoReviews(userId, ids, origin);
  after(async () => {
    try { await refreshContextForTrades(userId, ids, origin); }
    catch (e) { console.error("market context after save failed:", e instanceof Error ? e.message : "unknown error"); }
    try { await runClaimedReviews(userId, claimed); }
    catch (e) { console.error("AI review after save failed:", e instanceof Error ? e.message : "unknown error"); }
  });
}
