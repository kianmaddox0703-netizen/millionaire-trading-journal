import Link from "next/link";
import type { ReactNode } from "react";
import { parseAnswer, type Inline } from "@/domain/ai/coach";
import { BASIS, BASIS_HELP, BASIS_LABEL, type Basis } from "@/domain/ai/guard";
import { cx } from "@/components/ui";

const BASIS_TONE: Record<Basis, string> = {
  data: "border-line-strong bg-surface-3 text-muted",
  history: "border-info/30 bg-info-soft text-info",
  chart: "border-profit/30 bg-profit-soft text-profit",
  inference: "border-warn/30 bg-warn-soft text-warn",
  opinion: "border-warn/30 bg-warn-soft text-warn",
};

/** Small label saying where a claim comes from; the hover text explains the category. */
export function BasisBadge({ basis }: { basis: Basis }) {
  return (
    <span title={BASIS_HELP[basis]} className={cx("mx-0.5 inline-block whitespace-nowrap rounded border px-1 align-[1px] text-[11px] font-medium leading-4", BASIS_TONE[basis])}>
      {BASIS_LABEL[basis]}
    </span>
  );
}

export function BasisLegend() {
  return (
    <p className="flex flex-wrap items-center gap-1 text-[11px] text-faint">
      The coach is asked to tag each claim with its basis: {BASIS.map((b) => <BasisBadge key={b} basis={b} />)}
    </p>
  );
}

function inline(xs: Inline[], links: Record<string, string>): ReactNode[] {
  return xs.map((x, i) => {
    switch (x.t) {
      case "text": return x.v;
      case "br": return <br key={i} />;
      case "strong": return <strong key={i} className="font-semibold text-fg">{inline(x.c, links)}</strong>;
      case "em": return <em key={i}>{inline(x.c, links)}</em>;
      case "code": return <code key={i} className="num rounded bg-surface-3 px-1 text-[12px]">{x.v}</code>;
      case "basis": return <BasisBadge key={i} basis={x.basis} />;
      case "trade": {
        const id = links[String(x.seq)];
        return id ? <Link key={i} href={`/trades/${id}`} className="num text-info hover:underline">#{x.seq}</Link> : <span key={i} className="num">#{x.seq}</span>;
      }
      case "link": return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer nofollow" className="text-info underline-offset-2 hover:underline">{x.v}</a>;
    }
  });
}

/**
 * Renders a coach answer from the parsed tree; nothing in the text is ever treated as HTML.
 * links maps trade numbers to the signed-in user's trade ids (built server-side).
 */
export function CoachMessage({ text, links }: { text: string; links: Record<string, string> }) {
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {parseAnswer(text).map((b, i) => {
        switch (b.t) {
          case "p": return <p key={i}>{inline(b.c, links)}</p>;
          case "h": return <p key={i} className="font-semibold">{inline(b.c, links)}</p>;
          case "ul": return <ul key={i} className="list-disc space-y-1 pl-5 marker:text-faint">{b.items.map((it, j) => <li key={j}>{inline(it, links)}</li>)}</ul>;
          case "ol": return <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-faint">{b.items.map((it, j) => <li key={j}>{inline(it, links)}</li>)}</ol>;
          case "pre": return <pre key={i} className="scroll-thin num overflow-x-auto rounded bg-surface-2 p-2 text-[11px] leading-snug">{b.v}</pre>;
        }
      })}
    </div>
  );
}
