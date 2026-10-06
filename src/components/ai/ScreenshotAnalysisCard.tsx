import { Card } from "@/components/ui";

/** AI screenshot analysis for one trade's images (server component). Implemented in the screenshot work. */
export async function ScreenshotAnalysisCard({ userId, tradeId, tz }: { userId: string; tradeId: string; tz: string }) {
  void userId; void tradeId; void tz;
  return <Card title="Screenshot analysis"><div className="text-[12px] text-muted">Not built yet.</div></Card>;
}
