import { MessageSquare } from "lucide-react";
import { LinkButton } from "@/components/ui";
import { aiConfigured } from "@/server/ai/client";

/** Link from a trade to the AI coach with a question about it pre-filled. Hidden when no AI key is configured. */
export function AskCoachLink({ tradeId, seq }: { tradeId: string; seq: number }) {
  if (!aiConfigured()) return null;
  return (
    <LinkButton href={`/coach?trade=${encodeURIComponent(tradeId)}`} title={`Ask the coach whether trade #${seq} fits your plan`} data-ask-coach>
      <MessageSquare size={14} aria-hidden /> Ask coach
    </LinkButton>
  );
}
