import fs from "node:fs";
import path from "node:path";

/** Reads a fixture and encodes it as UTF-16LE with a BOM, the way MT5 saves HTML reports. */
export function utf16Fixture(name: string) {
  const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, "utf16le")]);
}
