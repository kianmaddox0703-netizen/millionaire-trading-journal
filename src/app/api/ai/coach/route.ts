import { getUser } from "@/server/auth";
import { selectedAccount } from "@/server/prefs";
import { handleCoachRequest } from "@/server/ai/coach";

// a question can take several tool rounds at medium effort
export const maxDuration = 300;

/** POST {"conversationId"?: "...", "message": "..."} → NDJSON stream of coach events for the signed-in user. */
export async function POST(req: Request) {
  const user = await getUser();
  return handleCoachRequest(user, req, { accountId: user ? await selectedAccount(user.id) : undefined });
}
