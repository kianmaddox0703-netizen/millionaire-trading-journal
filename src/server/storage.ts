import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { randomToken } from "./tokens";
import { dataDir } from "./config";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** Detect the real image type from magic bytes (never trust the client's MIME). */
export function sniffImage(buf: Buffer): (typeof ALLOWED_MIME)[number] | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const root = () => path.join(dataDir(), "uploads");

function safePath(key: string) {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(key)) throw new Error("Invalid storage key");
  return path.join(root(), key);
}

export interface StoredImage {
  storageKey: string;
  thumbKey: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Stores the original untouched (chart readability matters) and a 640px-wide
 * WebP thumbnail for lists. Interface kept small so an S3 implementation can replace it.
 */
export async function storeImage(ownerId: string, buf: Buffer): Promise<StoredImage> {
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 15 MB");
  const mime = sniffImage(buf);
  if (!mime) throw new Error("Only JPEG, PNG and WebP images are supported");
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image dimensions");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
  const dir = ownerId.replace(/[^A-Za-z0-9_-]/g, "");
  const name = randomToken(18);
  const storageKey = `${dir}/${name}.${ext}`;
  const thumbKey = `${dir}/${name}_t.webp`;
  await fs.mkdir(path.join(root(), dir), { recursive: true });
  const thumb = await sharp(buf).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  await fs.writeFile(safePath(storageKey), buf, { mode: 0o600 });
  await fs.writeFile(safePath(thumbKey), thumb, { mode: 0o600 });
  return { storageKey, thumbKey, mime, width: meta.width, height: meta.height, bytes: buf.length };
}

export async function readStored(key: string) {
  return fs.readFile(safePath(key));
}

export async function deleteStored(...keys: string[]) {
  await Promise.all(keys.map((k) => fs.rm(safePath(k), { force: true })));
}
