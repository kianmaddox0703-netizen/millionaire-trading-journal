"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, ZoomIn, ZoomOut, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { ImageDrop, IMAGE_KINDS, uploadImages } from "./ImageDrop";
import { deleteImageAction, updateImageAction } from "@/app/(app)/trades/actions";

export interface GalleryImage { id: string; kind: string; caption: string; width: number; height: number }

const label = (k: string) => IMAGE_KINDS.find(([x]) => x === k)?.[1] ?? k;

export function Gallery({ tradeId, images }: { tradeId: string; images: GalleryImage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const upload = (files: File[]) =>
    start(async () => {
      setErr("");
      const r = await uploadImages(tradeId, files.map((file, i) => ({ id: String(i), file, url: "", kind: images.length + i < 4 ? IMAGE_KINDS[images.length + i][0] : "other", caption: "" })));
      if (r.failed.length) setErr(r.failed.join("; "));
      router.refresh();
    });
  const cur = open !== null ? images[open] : null;
  return (
    <div>
      {images.length > 0 && (
        <ul className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <li key={img.id} className="overflow-hidden rounded border border-line bg-surface-2">
              <button type="button" onClick={() => { setOpen(i); setZoom(1); }} className="block w-full" aria-label={`Open ${label(img.kind)} screenshot`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${img.id}?size=thumb`} alt={img.caption || label(img.kind)} loading="lazy" className="w-full object-contain" style={{ aspectRatio: `${img.width}/${img.height}` }} />
              </button>
              <div className="flex items-center gap-1 border-t border-line p-1">
                <select defaultValue={img.kind} aria-label="Screenshot type" onChange={(e) => start(async () => { await updateImageAction(img.id, e.target.value, img.caption); router.refresh(); })} className="h-6 rounded border border-line bg-surface px-1 text-[11px]">
                  {IMAGE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input defaultValue={img.caption} placeholder="Caption" aria-label="Caption" onBlur={(e) => e.target.value !== img.caption && start(async () => { await updateImageAction(img.id, img.kind, e.target.value); })} className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1.5 text-[11px]" />
                <button type="button" aria-label="Delete screenshot" onClick={() => confirm("Delete this screenshot?") && start(async () => { await deleteImageAction(img.id); router.refresh(); })} className="grid h-6 w-6 place-items-center text-faint hover:text-loss"><Trash2 size={12} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ImageDrop staged={[]} onFiles={upload} />
      {pending && <div className="mt-1 text-[11px] text-muted">Uploading…</div>}
      {err && <div className="mt-1 text-[11px] text-loss">{err}</div>}

      {cur && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal onKeyDown={(e) => e.key === "Escape" && setOpen(null)}>
          <div className="flex items-center justify-between px-3 py-2 text-[12px] text-muted">
            <span>{label(cur.kind)} {cur.caption && `· ${cur.caption}`} · {cur.width}×{cur.height}</span>
            <div className="flex items-center gap-1">
              <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="grid h-8 w-8 place-items-center hover:text-fg"><ZoomOut size={16} /></button>
              <span className="num w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="grid h-8 w-8 place-items-center hover:text-fg"><ZoomIn size={16} /></button>
              <a href={`/api/files/${cur.id}`} target="_blank" rel="noreferrer" className="px-2 hover:text-fg">Original</a>
              <button aria-label="Close" autoFocus onClick={() => setOpen(null)} className="grid h-8 w-8 place-items-center hover:text-fg"><X size={18} /></button>
            </div>
          </div>
          <div className="relative flex-1 overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${cur.id}`} alt={cur.caption || label(cur.kind)} className="mx-auto block max-w-none" style={{ width: zoom === 1 ? "min(100%, " + cur.width + "px)" : cur.width * zoom }} />
            {images.length > 1 && <>
              <button aria-label="Previous" onClick={() => setOpen((o) => ((o ?? 0) - 1 + images.length) % images.length)} className="fixed left-2 top-1/2 grid h-10 w-10 place-items-center rounded bg-black/60 text-white"><ChevronLeft /></button>
              <button aria-label="Next" onClick={() => setOpen((o) => ((o ?? 0) + 1) % images.length)} className="fixed right-2 top-1/2 grid h-10 w-10 place-items-center rounded bg-black/60 text-white"><ChevronRight /></button>
            </>}
          </div>
        </div>
      )}
    </div>
  );
}
