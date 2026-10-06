"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import { MAX_MESSAGE_CHARS, NdjsonReader, SUGGESTED_QUESTIONS, toolList, type CoachEvent } from "@/domain/ai/coach";
import { BasisLegend, CoachMessage } from "./CoachMessage";

export interface CoachChatMessage { id: string; role: "user" | "assistant"; content: string; tools: string }

// Module scope so it survives the remount that follows the first answer of a new conversation.
let refocus = false;

/** The chat panel: streams answers from POST /api/ai/coach and renders them as they arrive. */
export function CoachChat({ conversationId, initial, initialLinks, prefill, scope }: {
  conversationId: string | null; initial: CoachChatMessage[]; initialLinks: Record<string, string>; prefill: string; scope: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [links, setLinks] = useState(initialLinks);
  const [input, setInput] = useState(prefill);
  const [live, setLive] = useState<{ text: string; status: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const conv = useRef(conversationId);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // An answer keeps streaming (and is saved) if the user leaves the page; it just mustn't navigate them back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const busy = live !== null;

  // the box is disabled while an answer streams; give focus back once it's done
  useEffect(() => {
    if (!busy && refocus) { refocus = false; box.current?.focus(); }
  }, [busy]);

  // keep the newest text in view unless the reader scrolled up
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    if (message.length > MAX_MESSAGE_CHARS) { setError(`Questions are limited to ${MAX_MESSAGE_CHARS} characters.`); return; }
    const pending: CoachChatMessage = { id: `pending-${Date.now()}`, role: "user", content: message, tools: "" };
    setError(null);
    setAnnounce("");
    setMessages((m) => [...m, pending]);
    setInput("");
    setLive({ text: "", status: "Thinking…" });
    stick.current = true;
    const ac = new AbortController();
    abort.current = ac;
    let text = "", newId: string | null = null, finished = false;
    // On failure nothing was stored: the question goes back into the box so it can be sent again.
    const fail = (msg: string) => {
      finished = true;
      refocus = true;
      setMessages((m) => m.filter((x) => x.id !== pending.id));
      setInput(message);
      setLive(null);
      setError(msg);
    };
    const handle = (ev: CoachEvent) => {
      switch (ev.type) {
        case "conversation": newId = ev.id; break;
        case "status": setLive((l) => l && { ...l, status: ev.text }); break;
        case "text": text += ev.delta; setLive({ text, status: null }); break;
        case "replace": text = ev.text; setLive({ text, status: null }); break;
        case "error": fail(ev.message); break;
        case "done": {
          finished = true;
          refocus = true;
          setMessages((m) => [...m.map((x) => (x.id === pending.id ? { ...x, id: `q-${ev.messageId}` } : x)), { id: ev.messageId, role: "assistant", content: text, tools: ev.tools.join(",") }]);
          setLinks((l) => ({ ...l, ...ev.links }));
          setLive(null);
          setAnnounce("Answer ready.");
          if (!mounted.current) break;
          if (newId && newId !== conv.current) {
            conv.current = newId;
            router.replace(`/coach?c=${newId}`, { scroll: false });
          } else router.refresh();
          break;
        }
      }
    };
    try {
      const res = await fetch("/api/ai/coach", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ conversationId: conv.current, message }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        fail(j.error ?? `The coach couldn't answer (${res.status}).`);
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      const nd = new NdjsonReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        nd.push(value).forEach(handle);
      }
      nd.flush().forEach(handle);
      if (!finished) fail("The connection closed before the answer finished. Try again.");
    } catch {
      if (!finished) fail(ac.signal.aborted ? "Stopped. Nothing was saved; your question is back in the box." : "Couldn't reach the server. Check your connection and try again.");
    } finally {
      abort.current = null;
    }
  }

  const empty = messages.length === 0 && !busy;
  return (
    <section aria-label="Coach chat" className="flex min-h-[460px] flex-col rounded-md border border-line bg-surface lg:h-[calc(100dvh-8.5rem)]">
      <div ref={list} aria-busy={busy} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
        {empty && (
          <div className="mx-auto max-w-xl space-y-3 py-4">
            <p className="text-[13px] text-muted">Ask about your own trading. The coach looks up your journal ({scope}) and shows how much evidence sits behind each answer.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <Button key={q} type="button" size="sm" onClick={() => send(q)} data-coach-suggestion>{q}</Button>
              ))}
            </div>
            <BasisLegend />
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px]">{m.content}</p>
            </div>
          ) : (
            <article key={m.id} className="max-w-3xl" data-coach-answer>
              <CoachMessage text={m.content} links={links} />
              {m.tools && <p className="mt-1 text-[11px] text-faint">Looked up: {toolList(m.tools)}</p>}
            </article>
          ),
        )}
        {live && (
          <div className="max-w-3xl" data-coach-live>
            {live.text && <CoachMessage text={live.text} links={links} />}
            {live.status && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted"><Loader2 size={13} className="animate-spin" aria-hidden />{live.status}</p>
            )}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="sr-only">{live?.status ?? announce}</div>
      <form className="border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        {error && <p role="alert" className="mb-2 rounded border border-loss/30 bg-loss-soft px-2 py-1.5 text-[12px] text-loss">{error}</p>}
        <label htmlFor="coach-input" className="sr-only">Ask the coach</label>
        <textarea ref={box} id="coach-input" value={input} autoFocus={!!prefill} rows={2} maxLength={MAX_MESSAGE_CHARS} disabled={busy} placeholder="Ask about your trades, setups, mistakes or plan…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
          className="block max-h-40 min-h-[52px] w-full resize-y rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-[13px] leading-snug text-fg placeholder:text-faint focus:border-info focus:outline-none disabled:opacity-60" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className={cx("num text-[11px]", input.length > MAX_MESSAGE_CHARS - 100 ? "text-warn" : "text-faint")}>{input.length}/{MAX_MESSAGE_CHARS} · Enter to send, Shift+Enter for a new line</span>
          {busy
            ? <Button type="button" size="sm" onClick={() => abort.current?.abort()}>Stop</Button>
            : <Button type="submit" variant="primary" size="sm" disabled={!input.trim()}>Send</Button>}
        </div>
        <p className="mt-2 text-[11px] text-faint">Decision support, not trade signals: the coach describes your history and never tells you to enter or exit a trade. To answer, your journal data (trades, notes, reviews, strategies) is sent to the Anthropic API.</p>
      </form>
    </section>
  );
}
