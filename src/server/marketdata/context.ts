import type { SaveOrigin } from "../hooks";

/** Fetches candles and stores market context for these trades. Implemented in the market-data work. */
export async function refreshContextForTrades(userId: string, tradeIds: string[], origin: SaveOrigin): Promise<void> {
  void userId; void tradeIds; void origin;
}
