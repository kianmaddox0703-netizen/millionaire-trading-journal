import { Card } from "@/components/ui";

/** Automatic market context for one trade (server component). Implemented in the market-data work. */
export async function MarketContextCard({ userId, tradeId, tz }: { userId: string; tradeId: string; tz: string }) {
  void userId; void tradeId; void tz;
  return <Card title="Market context"><div className="text-[12px] text-muted">Not built yet.</div></Card>;
}
