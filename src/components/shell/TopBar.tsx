"use client";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { MessageSquare, Plus, Search } from "lucide-react";
import Link from "next/link";

export function TopBar({ accounts, selected, selectAccount }: { accounts: { id: string; name: string }[]; selected: string; selectAccount: (id: string) => Promise<void> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  return (
    <header className="sticky top-0 z-20 flex h-12 print:hidden items-center gap-2 border-b border-line bg-bg/95 pl-14 pr-3 backdrop-blur lg:pl-4">
      <form className="relative max-w-md flex-1" onSubmit={(e) => { e.preventDefault(); router.push(`/trades?q=${encodeURIComponent(q)}`); }}>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: EURUSD, London, FOMO, A+ trades, biggest losses…"
          className="h-8 w-full rounded border border-line bg-surface pl-8 pr-2 text-[13px] placeholder:text-faint focus:border-info focus:outline-none" aria-label="Search trades" />
      </form>
      <select aria-label="Account" value={selected} disabled={pending} onChange={(e) => start(() => selectAccount(e.target.value))}
        className="h-8 max-w-[7.5rem] rounded border border-line bg-surface sm:max-w-[11rem] px-2 text-[12px] text-fg focus:border-info focus:outline-none">
        <option value="all">All accounts</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <Link href="/coach" title="Coach" className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-line-strong bg-surface-2 px-2.5 text-[13px] font-medium text-fg hover:bg-surface-3">
        <MessageSquare size={14} aria-hidden /> <span className="sr-only sm:not-sr-only">Coach</span>
      </Link>
      <Link href="/trades/new" className="inline-flex h-8 items-center gap-1 rounded border border-info-strong bg-info-strong px-2.5 text-[13px] font-medium text-white hover:bg-info-strong/90">
        <Plus size={14} /> <span className="hidden sm:inline">Add trade</span>
      </Link>
    </header>
  );
}
