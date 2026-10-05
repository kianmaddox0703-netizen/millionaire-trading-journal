"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, List, BookOpen, LineChart, CalendarDays, ClipboardCheck, AlertTriangle, Brain, BarChart3, Settings, Menu, X, LogOut } from "lucide-react";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trades", label: "Trades", icon: List },
  { href: "/strategies", label: "Strategies", icon: BookOpen },
  { href: "/market", label: "Market Analysis", icon: LineChart },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/mistakes", label: "Mistakes", icon: AlertTriangle },
  { href: "/psychology", label: "Psychology", icon: Brain },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ logout }: { logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="flex flex-1 flex-col gap-px p-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={cx("flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] transition-colors", active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
            <Icon size={15} strokeWidth={1.75} className={active ? "text-info" : undefined} />
            {label}
          </Link>
        );
      })}
      <form action={logout} className="mt-auto">
        <button className="flex h-8 w-full items-center gap-2.5 rounded px-2.5 text-[13px] text-faint hover:bg-surface-2 hover:text-fg">
          <LogOut size={15} strokeWidth={1.75} /> Sign out
        </button>
      </form>
    </nav>
  );
  const brand = (
    <Link href="/dashboard" className="flex h-12 items-center gap-2 border-b border-line px-4">
      <span className="grid h-6 w-6 place-items-center rounded bg-info/15 text-[11px] font-bold text-info">M</span>
      <span className="text-[13px] font-semibold tracking-tight">Millionaire <span className="text-muted">Journal</span></span>
    </Link>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-line bg-surface lg:flex">{brand}{nav}</aside>
      <button aria-label="Open menu" onClick={() => setOpen(true)} className="fixed left-3 top-2.5 z-30 grid h-8 w-8 place-items-center rounded border border-line bg-surface lg:hidden"><Menu size={16} /></button>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-line bg-surface">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-2 top-2.5 grid h-8 w-8 place-items-center text-muted"><X size={16} /></button>
            {brand}{nav}
          </aside>
        </div>
      )}
    </>
  );
}
