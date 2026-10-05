"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";

/** Unexpected errors inside the app shell. Details stay in the server log; the digest helps match them. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <Card title="Something went wrong" className="mx-auto mt-8 max-w-lg">
      <p className="text-[13px]">This page couldn't load. Your data is safe; nothing was changed.</p>
      {error.digest && <p className="mt-1 text-[12px] text-muted">Reference: <code>{error.digest}</code></p>}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" onClick={() => retry()}>Try again</Button>
        <Link href="/dashboard" className="inline-flex h-7 items-center rounded border border-line-strong bg-surface-2 px-2 text-[12px] hover:bg-surface-3">Go to dashboard</Link>
      </div>
    </Card>
  );
}
