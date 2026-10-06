"use client";
import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { cx } from "@/components/ui";
import { deleteConversationAction } from "@/app/(app)/coach/actions";

/** Recent conversations, newest first, each with a delete button. */
export function CoachConversations({ items, currentId }: { items: { id: string; title: string; when: string }[]; currentId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const remove = (id: string, title: string) => {
    if (!confirm(`Delete the conversation “${title}”? This cannot be undone.`)) return;
    start(async () => {
      const r = await deleteConversationAction(id);
      if (!r.ok) alert(r.error);
      else if (id === currentId) router.push("/coach");
      else router.refresh();
    });
  };
  return (
    <nav aria-label="Coach conversations" className="rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Conversations</h2>
        <Link href="/coach" className="inline-flex items-center gap-1 text-[12px] text-info hover:underline"><Plus size={13} aria-hidden />New</Link>
      </div>
      {!items.length ? (
        <p className="px-3 py-3 text-[12px] text-faint">No conversations yet.</p>
      ) : (
        <ul className="scroll-thin max-h-[40vh] divide-y divide-line/60 overflow-y-auto lg:max-h-[calc(100dvh-11rem)]" aria-busy={pending}>
          {items.map((c) => (
            <li key={c.id} className={cx("group flex items-start gap-1 px-2 py-1.5", c.id === currentId && "bg-surface-3")}>
              <Link href={`/coach?c=${c.id}`} aria-current={c.id === currentId ? "page" : undefined} className="min-w-0 flex-1 rounded px-1 py-0.5 hover:text-info">
                <span className="block truncate text-[12px]">{c.title || "Untitled"}</span>
                <span className="block text-[11px] text-faint">{c.when}</span>
              </Link>
              <button type="button" disabled={pending} onClick={() => remove(c.id, c.title)} data-coach-delete={c.id}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-faint hover:bg-loss-soft hover:text-loss disabled:opacity-50">
                Delete<span className="sr-only"> conversation {c.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
