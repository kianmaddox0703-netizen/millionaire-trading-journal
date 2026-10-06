import { describe, it, expect } from "vitest";
import { readBody, readFormData, readJson, readText } from "@/server/http";

/** A request whose body arrives in chunks with no Content-Length, like a chunked upload. */
function chunked(parts: string[], contentType = "application/json") {
  const enc = new TextEncoder();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulled < parts.length) c.enqueue(enc.encode(parts[pulled++]));
      else c.close();
    },
  });
  return { req: new Request("http://x/", { method: "POST", body, headers: { "content-type": contentType }, duplex: "half" } as RequestInit), pulled: () => pulled };
}

describe("bounded request bodies", () => {
  it("stops reading a chunked body as soon as it passes the cap", async () => {
    const r = chunked(Array(100).fill("x".repeat(1000)));
    expect(await readBody(r.req, 5_000)).toBeNull();
    expect(r.pulled()).toBeLessThan(10);
  });

  it("refuses a declared Content-Length over the cap without reading", async () => {
    const req = new Request("http://x/", { method: "POST", body: "x".repeat(100), headers: { "content-length": "100" } });
    expect(await readText(req, 10)).toEqual({ ok: false, tooLarge: true });
  });

  it("reads JSON, text and form data under the cap", async () => {
    expect(await readJson(chunked(['{"a":', "1}"]).req, 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJson(chunked(["{not json"]).req, 100)).toEqual({ ok: false, tooLarge: false });
    expect(await readText(chunked(["hé", "llo"]).req, 100)).toEqual({ ok: true, value: "héllo" });
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    fd.append("kind", "entry");
    const r = await readFormData(new Request("http://x/", { method: "POST", body: fd }), 10_000);
    expect(r.ok && r.value.get("kind")).toBe("entry");
    expect(r.ok && (r.value.get("file") as File).size).toBe(3);
  });
});
