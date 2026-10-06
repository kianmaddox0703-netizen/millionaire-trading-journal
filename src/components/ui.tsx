import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { STRENGTH_LABEL, type Strength } from "@/domain/metrics";

export const cx = clsx;

export function Card({ className, children, title, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("min-w-0 rounded-md border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? "p-3" : undefined}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, valueClass, hint }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="truncate text-[11px] text-muted">{label}</div>
      <div className={cx("num truncate text-[17px] font-medium leading-6", valueClass)}>{value}</div>
      {sub !== undefined && <div className="num truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function StatGrid({ children, cols = 6 }: { children: ReactNode; cols?: number }) {
  const c = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-4 2xl:grid-cols-6", 7: "lg:grid-cols-4 2xl:grid-cols-7", 8: "lg:grid-cols-4 2xl:grid-cols-8" }[cols] ?? "lg:grid-cols-6";
  return <div className={cx("grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3", c)}>{children}</div>;
}

type Tone = "neutral" | "profit" | "loss" | "warn" | "info";
const toneCls: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line-strong",
  profit: "bg-profit-soft text-profit border-profit/30",
  loss: "bg-loss-soft text-loss border-loss/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  info: "bg-info-soft text-info border-info/30",
};
export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-medium", toneCls[tone], className)}>{children}</span>;
}

export function StrengthBadge({ s, n }: { s: Strength; n?: number }) {
  const t: Record<Strength, Tone> = { insufficient: "neutral", weak: "warn", moderate: "info", strong: "profit" };
  return <Badge tone={t[s]} title={n !== undefined ? `Sample size ${n}` : undefined}>{STRENGTH_LABEL[s]}{n !== undefined ? ` · n=${n}` : ""}</Badge>;
}

export function Button({ variant = "default", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: "default" | "primary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2 text-[12px]" : "h-8 px-3 text-[13px]",
        variant === "primary" && "border-info-strong bg-info-strong text-white hover:bg-info-strong/90",
        variant === "default" && "border-line-strong bg-surface-2 text-fg hover:bg-surface-3",
        variant === "ghost" && "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
        variant === "danger" && "border-loss/40 bg-loss-soft text-loss hover:bg-loss/20",
        className,
      )}
    />
  );
}

export function LinkButton({ variant = "default", className, ...p }: ComponentProps<typeof Link> & { variant?: "default" | "primary" | "ghost" }) {
  return (
    <Link
      {...p}
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-[13px] font-medium transition-colors",
        variant === "primary" && "border-info-strong bg-info-strong text-white hover:bg-info-strong/90",
        variant === "default" && "border-line-strong bg-surface-2 text-fg hover:bg-surface-3",
        variant === "ghost" && "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
        className,
      )}
    />
  );
}

export const inputCls = "h-8 w-full rounded border border-line-strong bg-surface-2 px-2 text-[13px] text-fg placeholder:text-faint focus:border-info focus:outline-none";

export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input {...p} className={cx(inputCls, className)} />;
}
export function Select({ className, children, ...p }: ComponentProps<"select">) {
  return <select {...p} className={cx(inputCls, "pr-6", className)}>{children}</select>;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea {...p} className={cx(inputCls, "h-auto min-h-[72px] py-1.5 leading-snug", className)} />;
}
export function Field({ label, children, hint, className, error }: { label: string; children: ReactNode; hint?: string; className?: string; error?: string }) {
  return (
    <label className={cx("block min-w-0", className)}>
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      {children}
      {hint && !error && <span className="mt-0.5 block text-[11px] text-faint">{hint}</span>}
      {error && <span className="mt-0.5 block text-[11px] text-loss">{error}</span>}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line px-6 py-10 text-center">
      <div className="text-[13px] font-medium">{title}</div>
      {children && <div className="max-w-md text-[12px] text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div tabIndex={0} className={cx("scroll-thin overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  );
}
export const th = "whitespace-nowrap border-b border-line px-2 py-1.5 text-left text-[11px] font-medium text-muted";
export const td = "whitespace-nowrap border-b border-line/60 px-2 py-1.5";

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return <div className={cx("rounded border px-3 py-2 text-[12px]", toneCls[tone])}>{children}</div>;
}
