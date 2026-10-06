import { getUser } from "@/server/auth";
import { handleAnalyzeRequest } from "@/server/ai/screenshot";

// a vision request at medium effort can take a minute or more
export const maxDuration = 300;

/** POST {"imageId": "..."} → AI analysis of one of the signed-in user's trade screenshots, stored in ai_analysis. */
export async function POST(req: Request) {
  return handleAnalyzeRequest(await getUser(), req);
}
