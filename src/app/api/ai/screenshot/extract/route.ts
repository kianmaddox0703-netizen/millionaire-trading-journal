import { getUser } from "@/server/auth";
import { handleExtractRequest } from "@/server/ai/screenshot";

export const maxDuration = 300;

/** POST multipart "file" → symbol/timeframe/direction/entry/stop/TP readings for the trade form. Nothing is stored. */
export async function POST(req: Request) {
  return handleExtractRequest(await getUser(), req);
}
