"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deleteTradeAction } from "@/app/(app)/trades/actions";

export function DeleteTrade({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="danger" disabled={pending} onClick={() => confirm("Delete this trade, its journal and screenshots? This cannot be undone.") && start(async () => {
      const r = await deleteTradeAction(id);
      if (r.ok) router.push("/trades"); else alert(r.error);
    })}>Delete</Button>
  );
}
