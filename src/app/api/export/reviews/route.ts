import { eq } from "drizzle-orm";
import { getUser } from "@/server/auth";
import { db, schema } from "@/server/db";
import { toCsv } from "@/lib/csv";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const strip = <T extends { userId: string; id: string }>({ userId: _u, id: _i, ...r }: T) => r;
  const weekly = db.select().from(schema.weeklyReviews).where(eq(schema.weeklyReviews.userId, user.id)).all().map(strip);
  const monthly = db.select().from(schema.monthlyReviews).where(eq(schema.monthlyReviews.userId, user.id)).all().map(strip);
  const stamp = new Date().toISOString().slice(0, 10);
  if (new URL(req.url).searchParams.get("format") === "csv")
    return new Response(toCsv(weekly), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="weekly-reviews-${stamp}.csv"` } });
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), weekly, monthly }, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="reviews-${stamp}.json"` },
  });
}
