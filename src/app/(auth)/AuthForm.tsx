"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import type { AuthState } from "./actions";

export function AuthForm({ mode, action }: { mode: "login" | "register"; action: (s: AuthState, fd: FormData) => Promise<AuthState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [tz, setTz] = useState("UTC");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-md border border-line bg-surface p-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Millionaire Trading Journal</div>
          <h1 className="mt-1 text-[18px] font-semibold">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        </div>
        {mode === "register" && <Field label="Name"><Input name="name" autoComplete="name" /></Field>}
        <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" hint={mode === "register" ? "At least 10 characters." : undefined}>
          <Input name="password" type="password" required autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        <input type="hidden" name="timezone" value={tz} />
        {state?.error && <div className="text-[12px] text-loss" role="alert">{state.error}</div>}
        <Button variant="primary" className="w-full" disabled={pending}>{pending ? "…" : mode === "login" ? "Sign in" : "Create account"}</Button>
        <div className="text-center text-[12px] text-muted">
          {mode === "login" ? <>No account? <Link className="text-info" href="/register">Create one</Link></> : <>Have an account? <Link className="text-info" href="/login">Sign in</Link></>}
        </div>
      </form>
    </div>
  );
}
