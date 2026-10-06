/**
 * Request bodies read with a hard size cap. Content-Length alone isn't enough: a chunked upload has none,
 * and Request.json()/formData() would buffer any amount before the route could check it.
 */

/** The body as bytes, or null as soon as it exceeds maxBytes. */
export async function readBody(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export type Bounded<T> = { ok: true; value: T } | { ok: false; tooLarge: boolean };

/** UTF-8 text of the body, capped. */
export async function readText(req: Request, maxBytes: number): Promise<Bounded<string>> {
  const b = await readBody(req, maxBytes);
  return b ? { ok: true, value: new TextDecoder().decode(b) } : { ok: false, tooLarge: true };
}

/** Parsed JSON body, capped. Invalid JSON is { ok: false, tooLarge: false }. */
export async function readJson(req: Request, maxBytes: number): Promise<Bounded<unknown>> {
  const t = await readText(req, maxBytes);
  if (!t.ok) return t;
  try {
    return { ok: true, value: JSON.parse(t.value) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/** Multipart form data, capped. A body that isn't valid form data is { ok: false, tooLarge: false }. */
export async function readFormData(req: Request, maxBytes: number): Promise<Bounded<FormData>> {
  const b = await readBody(req, maxBytes);
  if (!b) return { ok: false, tooLarge: true };
  try {
    const value = await new Response(b, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
    return { ok: true, value };
  } catch {
    return { ok: false, tooLarge: false };
  }
}
