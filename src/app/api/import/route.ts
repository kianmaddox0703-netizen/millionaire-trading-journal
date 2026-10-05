import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getUser } from "@/server/auth";
import { NotFoundError } from "@/server/trades";
import { ImportError, MAX_IMPORT_BYTES, buildPreview, commitImport, costsLookPositive, parseFile, type Decision } from "@/server/importer";
import { matchAlertsForUser } from "@/server/tradingview";
import { REQUIRED_FIELDS, TARGET_FIELDS, type ColumnMap } from "@/domain/importing";

const validZone = (z: string) => {
  if (z === "BROKER_NY7" || z === "PROFILE" || z === "UTC") return true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
};

function readMapping(raw: FormDataEntryValue | null, columns: number): ColumnMap | null {
  if (typeof raw !== "string" || !raw) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  const out: ColumnMap = {};
  if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj))
      if ((TARGET_FIELDS as readonly string[]).includes(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) < columns) out[k as keyof ColumnMap] = v as number;
  return out;
}

function readDecisions(raw: FormDataEntryValue | null): Record<number, Decision> {
  const out: Record<number, Decision> = {};
  try {
    const obj = typeof raw === "string" && raw ? JSON.parse(raw) : {};
    for (const [k, v] of Object.entries(obj ?? {})) if (/^\d+$/.test(k) && (v === "skip" || v === "merge" || v === "create")) out[+k] = v;
  } catch { /* no decisions → defaults */ }
  return out;
}

const cellText = (c: unknown) => (c instanceof Date ? c.toISOString().replace("T", " ").slice(0, 19) : c === null || c === undefined ? "" : String(c).slice(0, 80));

/** POST multipart: file, action=preview|commit, accountId, zone (AUTO picks by format), dayFirst, costsPositive, mapping, decisions */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  if (!fd || !(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "File is larger than 10 MB" }, { status: 413 });
  const zoneIn = String(fd.get("zone") ?? "AUTO");
  if (zoneIn !== "AUTO" && !validZone(zoneIn)) return NextResponse.json({ error: "Unknown timezone" }, { status: 400 });

  try {
    const parsed = await parseFile(Buffer.from(await file.arrayBuffer()));
    const mapping = readMapping(fd.get("mapping"), parsed.headers.length) ?? parsed.mapping;
    const zone = zoneIn === "AUTO" ? (parsed.format === "mt5_report" ? "BROKER_NY7" : "PROFILE") : zoneIn;
    const o = { accountId: String(fd.get("accountId") ?? ""), mapping, zone, dayFirst: fd.get("dayFirst") === "1", costsPositive: fd.get("costsPositive") === "1" };

    if (fd.get("action") === "commit") {
      const sum = commitImport(user.id, parsed, o, readDecisions(fd.get("decisions")));
      if (sum.created + sum.merged > 0) {
        matchAlertsForUser(user.id);
        revalidatePath("/", "layout");
      }
      return NextResponse.json(sum);
    }

    const missing = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
    const rows = missing.length ? [] : buildPreview(user.id, parsed, o);
    const trades = rows.flatMap((r) => (r.status === "error" ? [] : [r.trade]));
    return NextResponse.json({
      kind: parsed.kind, format: parsed.format, headers: parsed.headers, notices: parsed.notices, mapping, zone, missing,
      sample: parsed.rows.slice(0, 5).map((r) => parsed.headers.map((_, i) => cellText(r[i]))),
      costsHint: costsLookPositive(trades), rows,
    });
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("import failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
