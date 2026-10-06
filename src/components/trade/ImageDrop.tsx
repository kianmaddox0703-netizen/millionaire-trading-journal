"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { cx } from "@/components/ui";

export const IMAGE_KINDS = [
  ["before", "Before entry"], ["entry", "Entry"], ["during", "During trade"], ["exit", "Exit"], ["tradingview", "TradingView"], ["mt5", "MT5"], ["other", "Other"],
] as const;

export interface StagedImage { id: string; file: File; url: string; kind: string; caption: string }

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const MAX = 15 * 1024 * 1024;

export async function uploadImages(tradeId: string, imgs: StagedImage[]) {
  const failed: string[] = [];
  for (const img of imgs) {
    const fd = new FormData();
    fd.append("file", img.file);
    fd.append("kind", img.kind);
    fd.append("caption", img.caption);
    const res = await fetch(`/api/trades/${tradeId}/images`, { method: "POST", body: fd });
    if (!res.ok) failed.push(`${img.file.name}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
  }
  return { failed };
}

/**
 * Drag-and-drop, paste-from-clipboard and multi-file picker. Images are staged locally until uploaded.
 * With onRead, each staged image gets a "Read screenshot" button (AI quick entry); readingId marks the one being read.
 */
export function ImageDrop({ staged, setStaged, onFiles, onRead, readingId }: {
  staged: StagedImage[]; setStaged?: (f: (p: StagedImage[]) => StagedImage[]) => void; onFiles?: (files: File[]) => void;
  onRead?: (img: StagedImage) => void; readingId?: string | null;
}) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const guessKind = (n: number) => IMAGE_KINDS[Math.min(n, 3)][0];

  const add = (files: File[]) => {
    setErr("");
    const ok = files.filter((f) => ACCEPT.includes(f.type) && f.size <= MAX);
    if (ok.length < files.length) setErr("Only JPEG, PNG or WebP up to 15 MB.");
    if (!ok.length) return;
    if (onFiles) return onFiles(ok);
    setStaged?.((prev) => [...prev, ...ok.map((file, i) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), kind: guessKind(prev.length + i), caption: "" }))]);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); add(files.map((f, i) => new File([f], f.name && f.name !== "image.png" ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type }))); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        className={cx("flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed px-4 py-6 text-center text-[12px] transition-colors", over ? "border-info bg-info-soft text-info" : "border-line-strong text-muted hover:border-info/60")}
      >
        <ImagePlus size={18} />
        <span>Drop chart screenshots, click to choose, or paste (Ctrl/⌘+V)</span>
        <span className="text-faint">JPEG, PNG, WebP · originals kept at full quality</span>
        <input ref={input} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      {err && <div className="mt-1 text-[11px] text-loss">{err}</div>}
      {setStaged && staged.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {staged.map((img) => (
            <li key={img.id} className="overflow-hidden rounded border border-line bg-surface-2">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="aspect-video w-full object-cover" />
                <button type="button" aria-label="Remove" onClick={() => setStaged((p) => p.filter((x) => x.id !== img.id))} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-black/70 text-white"><X size={12} /></button>
              </div>
              <div className="flex gap-1 p-1">
                <select value={img.kind} onChange={(e) => setStaged((p) => p.map((x) => (x.id === img.id ? { ...x, kind: e.target.value } : x)))} className="h-6 flex-1 rounded border border-line bg-surface px-1 text-[11px]">
                  {IMAGE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              {onRead && (
                <div className="px-1 pb-1">
                  <button type="button" onClick={() => onRead(img)} disabled={Boolean(readingId)} className="h-6 w-full rounded border border-line-strong bg-surface px-1 text-[11px] text-fg hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50">
                    {readingId === img.id ? "Reading…" : "Read screenshot"}<span className="sr-only"> {img.file.name}</span>
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
