"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { Button } from "@/components/ui";
import { saveAiKey, removeAiKey } from "./actions";

export interface AiKeyCardProps {
  source: "own" | "server" | "none";
  hint: string | null;
}

export function AiKeyCard({ source, hint }: AiKeyCardProps) {
  const [removing, setRemoving] = useState(false);

  if (source === "server") {
    return <div className="text-[13px] text-muted">AI is configured on the server environment (ANTHROPIC_API_KEY).</div>;
  }

  if (source === "own") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded bg-surface-2 p-2">
          <div className="text-[13px]">
            <div className="font-medium">Your Anthropic key is saved</div>
            <div className="text-[12px] text-muted">Ends with {hint}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRemoving(true)}
          >
            Remove
          </Button>
        </div>
        {removing && (
          <div className="rounded border border-line bg-surface-2 p-2">
            <p className="mb-2 text-[13px] text-muted">
              Remove your saved key? You can add a new one anytime.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await removeAiKey();
                  setRemoving(false);
                }}
              >
                Yes, remove
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoving(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="text-[12px] text-muted">
          Want to use a different key?{" "}
          <button className="text-link hover:underline" onClick={() => setRemoving(true)}>
            Remove this one first.
          </button>
        </div>
      </div>
    );
  }

  return (
    <ActionForm action={saveAiKey} submit="Save key">
      <div className="space-y-3">
        <div>
          <label className="block text-[13px] font-medium mb-1">Paste your Anthropic API key</label>
          <input
            type="password"
            name="anthropicKey"
            placeholder="sk-ant-…"
            autoComplete="off"
            className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-[13px] font-mono placeholder:text-muted"
            required
          />
        </div>
        <p className="text-[12px] text-muted">
          Get an API key from the{" "}
          <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
            Anthropic console
          </a>
          . Your key is encrypted and stored locally—it stays on this server and is never logged or sent to the browser.
        </p>
      </div>
    </ActionForm>
  );
}
