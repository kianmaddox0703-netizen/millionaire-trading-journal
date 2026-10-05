"use client";
import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui";

type R = { ok?: boolean; error?: string };

/** A form bound to a server action with inline saved/error feedback. */
export function ActionForm({ action, children, submit = "Save", className }: { action: (s: R, fd: FormData) => Promise<R>; children: ReactNode; submit?: string; className?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-3 flex items-center justify-end gap-2">
        {state.ok && !pending && <span className="text-[12px] text-profit">Saved</span>}
        {state.error && <span className="text-[12px] text-loss" role="alert">{state.error}</span>}
        <Button variant="primary" size="sm" disabled={pending}>{pending ? "Saving…" : submit}</Button>
      </div>
    </form>
  );
}
