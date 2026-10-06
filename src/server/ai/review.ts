import type { SaveOrigin } from "../hooks";

/** Generates the one-time AI review for newly closed trades. Implemented in the AI review work. */
export async function autoReviewTrades(userId: string, tradeIds: string[], origin: SaveOrigin): Promise<void> {
  void userId; void tradeIds; void origin;
}
