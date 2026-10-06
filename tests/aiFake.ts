/**
 * TEST DOUBLE for the Anthropic SDK client. Not the real API.
 *
 * It returns responses queued by each test so the app's own code around the API (prompt
 * building, user scoping, validation, guardrails, storage, UI data) can be tested without a
 * key. Nothing here says anything about how the real model behaves; live behaviour is only
 * verified with a real ANTHROPIC_API_KEY.
 */
import type { AiClient } from "@/server/ai/client";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "thinking"; thinking: string; signature: string };

export interface FakeTurn {
  /** for messages.parse: the parsed object to return (also serialised as the text block) */
  parsed?: unknown;
  /** for messages.stream / create: the content blocks to return */
  content?: Block[];
  stop_reason?: "end_turn" | "tool_use" | "max_tokens" | "refusal";
  usage?: { input_tokens: number; output_tokens: number };
  /** throw this instead of answering */
  error?: Error;
}

export class FakeAnthropic {
  readonly requests: Record<string, unknown>[] = [];
  private readonly queue: FakeTurn[] = [];

  push(...turns: FakeTurn[]) { this.queue.push(...turns); return this; }
  get pending() { return this.queue.length; }

  private next(body: Record<string, unknown>) {
    this.requests.push(structuredClone(body));
    const t = this.queue.shift();
    if (!t) throw new Error("FakeAnthropic: no queued response for this request");
    if (t.error) throw t.error;
    const content: Block[] = t.content ?? (t.parsed !== undefined ? [{ type: "text", text: JSON.stringify(t.parsed) }] : []);
    return {
      id: `msg_fake_${this.requests.length}`, type: "message", role: "assistant", model: String(body.model ?? "fake"),
      content, stop_reason: t.stop_reason ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"), stop_sequence: null,
      usage: t.usage ?? { input_tokens: 100, output_tokens: 50 },
      parsed_output: t.parsed ?? null,
    };
  }

  readonly beta = {
    messages: {
      parse: async (body: Record<string, unknown>) => this.next(body),
      create: async (body: Record<string, unknown>) => this.next(body),
      stream: (body: Record<string, unknown>) => {
        let msg: ReturnType<FakeAnthropic["next"]> | null = null;
        let err: unknown = null;
        try { msg = this.next(body); } catch (e) { err = e; }
        const events: Record<string, unknown>[] = msg ? msg.content.flatMap((b, index): Record<string, unknown>[] => b.type === "text"
          ? [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }, ...chunk(b.text).map((text) => ({ type: "content_block_delta", index, delta: { type: "text_delta", text } })), { type: "content_block_stop", index }]
          : [{ type: "content_block_start", index, content_block: b }, { type: "content_block_stop", index }]) : [];
        return {
          async *[Symbol.asyncIterator]() { if (err) throw err; for (const e of events) yield e; },
          finalMessage: async () => { if (err) throw err; return msg!; },
          abort: () => {},
        };
      },
    },
  };

  asClient() { return this as unknown as AiClient; }
}

function chunk(s: string) {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 12) out.push(s.slice(i, i + 12));
  return out.length ? out : [""];
}
