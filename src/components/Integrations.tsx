"use client";
import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Badge, Button, Field, Input, Note, Select } from "@/components/ui";
import { createBridgeKeyAction, createWebhookAction, linkAlertAction, revokeBridgeKeyAction, revokeWebhookAction, unlinkAlertAction } from "@/app/(app)/settings/integrations/actions";

export function CopyBlock({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded border border-line bg-surface-2 p-2 pr-10 text-[11.5px] leading-relaxed"><code>{text}</code></pre>
      <button
        type="button" aria-label={label ?? "Copy"} title="Copy"
        onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted hover:bg-surface-3 hover:text-fg"
      >{done ? <Check className="h-3.5 w-3.5 text-profit" /> : <Copy className="h-3.5 w-3.5" />}</button>
    </div>
  );
}

export function WebhookControls({ exists, publicUrl }: { exists: boolean; publicUrl: boolean }) {
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {url ? (
        <>
          <Note tone="warn">Copy this URL now. It is shown once; only a hash is stored. Anyone with the URL can post alerts to your journal, so treat it like a password.</Note>
          <CopyBlock text={url} label="Copy webhook URL" />
          {!publicUrl && <Note tone="warn">This URL points at a local address. TradingView can only reach a public HTTPS address on port 443 or 80, so set APP_URL to your deployed address (or a tunnel) before using it.</Note>}
        </>
      ) : exists ? <div className="text-[12px] text-muted">A webhook URL is active. Replacing it stops the old one immediately.</div> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={exists ? "default" : "primary"} disabled={pending} onClick={() => start(async () => setUrl((await createWebhookAction()).url))}>{exists ? "Replace webhook URL" : "Create webhook URL"}</Button>
        {exists && <Button size="sm" variant="danger" disabled={pending} onClick={() => confirm("Turn off TradingView alerts? The current URL will stop working.") && start(async () => { await revokeWebhookAction(); setUrl(""); })}>Turn off</Button>}
      </div>
    </div>
  );
}

export function BridgeKeyForm({ accounts, appUrl }: { accounts: { id: string; name: string }[]; appUrl: string }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [label, setLabel] = useState("My PC");
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Sync into account"><Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Label"><Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Button size="sm" variant="primary" disabled={pending || !accountId} onClick={() => start(async () => { const r = await createBridgeKeyAction(accountId, label); setKey(r.key ?? ""); setErr(r.error ?? ""); })}>Create API key</Button>
      </div>
      {err && <div className="text-[12px] text-loss" role="alert">{err}</div>}
      {key && (
        <>
          <Note tone="warn">Copy the key now. It is shown once. It can only add trade history to this one account; it cannot read your journal or place trades.</Note>
          <div className="text-[12px] text-muted">On the Windows PC running MT5 (Command Prompt):</div>
          <CopyBlock label="Copy commands" text={`set MTJ_URL=${appUrl}\nset MTJ_KEY=${key}\npython mt5_bridge.py --check\npython mt5_bridge.py --watch`} />
        </>
      )}
    </div>
  );
}

export function RevokeKey({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Revoke this key? The bridge using it will stop syncing.") && start(() => revokeBridgeKeyAction(id))}>Revoke</Button>;
}

export interface LinkedAlert { id: string; symbol: string | null; timeframe: string | null; side: string | null; price: number | null; setup: string | null; message: string | null; at: string; status: "suggested" | "confirmed"; score: number | null }

export function TradeAlerts({ tradeId, linked, nearby }: { tradeId: string; linked: LinkedAlert[]; nearby: { id: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [pick, setPick] = useState("");
  return (
    <div className="space-y-2 text-[12px]">
      {linked.length === 0 && <div className="text-muted">No TradingView alert is linked to this trade.</div>}
      {linked.map((a) => (
        <div key={a.id} className="rounded border border-line bg-surface-2 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{a.symbol ?? "Alert"}</span>{a.timeframe && <Badge>{a.timeframe}</Badge>}{a.side && <Badge>{a.side}</Badge>}
            {a.status === "suggested" ? <Badge tone="warn">Suggested match{a.score !== null ? ` · ${Math.round(a.score * 100)}%` : ""}</Badge>
              : <Badge tone="info">{a.score === null ? "Linked by you" : `Auto-linked · ${Math.round(a.score * 100)}%`}</Badge>}
          </div>
          <div className="mt-1 text-muted">{a.at}{a.price !== null ? ` · price ${a.price}` : ""}{a.setup ? ` · ${a.setup}` : ""}</div>
          {a.message && <div className="mt-1 whitespace-pre-wrap">{a.message}</div>}
          <div className="mt-1.5 flex gap-1.5">
            {a.status === "suggested" && <Button size="sm" disabled={pending} onClick={() => start(() => linkAlertAction(tradeId, a.id))}>Confirm</Button>}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => unlinkAlertAction(tradeId, a.id))}>{a.status === "suggested" ? "Not this trade" : "Unlink"}</Button>
          </div>
        </div>
      ))}
      {nearby.length > 0 && (
        <div className="flex gap-1.5">
          <Select aria-label="Alert to link" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1">
            <option value="">Link another alert…</option>
            {nearby.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </Select>
          <Button size="sm" disabled={!pick || pending} onClick={() => start(async () => { await linkAlertAction(tradeId, pick); setPick(""); })}>Link</Button>
        </div>
      )}
    </div>
  );
}
