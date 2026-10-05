import fs from "node:fs/promises";
import path from "node:path";
import { getUser } from "@/server/auth";

/** Download of the read-only bridge script (bridge/mt5_bridge.py in the repo). Contains no secrets. */
export async function GET() {
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });
  const file = await fs.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "bridge", "mt5_bridge.py"));
  return new Response(file, { headers: { "Content-Type": "text/x-python; charset=utf-8", "Content-Disposition": 'attachment; filename="mt5_bridge.py"' } });
}
