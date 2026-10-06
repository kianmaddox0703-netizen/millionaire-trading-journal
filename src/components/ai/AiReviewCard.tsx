import { Card } from "@/components/ui";

/** AI trade review for one trade (server component). Implemented in the AI review work. */
export async function AiReviewCard({ userId, tradeId, tz }: { userId: string; tradeId: string; tz: string }) {
  void userId; void tradeId; void tz;
  return <Card title="AI trade review"><div className="text-[12px] text-muted">Not built yet.</div></Card>;
}
