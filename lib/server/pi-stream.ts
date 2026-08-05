import type { ChatStreamEvent, TranscriptBlock } from "@/lib/shared/types";

// Concatenate the text or thinking content of an assistant message snapshot.
function fullContent(partial: unknown, kind: "text" | "thinking"): string {
  const content = (partial as { content?: unknown })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => (c as { type?: string })?.type === kind)
    .map((c) => (kind === "text" ? (c as { text?: string }).text : (c as { thinking?: string }).thinking) ?? "")
    .join("");
}

// Shared mapping from raw pi AgentSession events to the ChatStreamEvent envelope
// the UI renders. Holds a monotonic assistant message id so full-snapshot
// updates upsert in place and duplicate deliveries never double the text.
// Used by both Implement mode chat and the read only review stream.
// Reconstruct transcript blocks from a persisted pi session's message history.
// AssistantMessage.content is (TextContent | ThinkingContent | ToolCall)[] and
// ToolResultMessage carries tool outcomes, so thinking, tool calls and response
// text all round-trip from the JSONL the SDK persists.
export function messagesToBlocks(messages: unknown[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let mid = 0;
  for (const raw of messages ?? []) {
    const m = raw as { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean };
    if (m.role === "user") {
      const text = contentText(m.content);
      if (text) blocks.push({ key: `u${mid}`, kind: "user", text });
      mid++;
      continue;
    }
    if (m.role === "assistant") {
      mid++;
      const parts = Array.isArray(m.content) ? m.content : [];
      let text = "";
      let thinking = "";
      for (const p of parts) {
        const c = p as { type?: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };
        if (c.type === "text") text += c.text ?? "";
        else if (c.type === "thinking") thinking += c.thinking ?? "";
        else if (c.type === "toolCall") {
          let args = "";
          try { args = c.arguments ? JSON.stringify(c.arguments) : ""; } catch { args = ""; }
          blocks.push({ key: `tool${c.id ?? ""}`, kind: "tool", name: c.name ?? "", args: args.slice(0, 400), status: "done" });
        }
      }
      if (thinking) blocks.push({ key: `t${mid}`, kind: "thinking", text: thinking });
      if (text) blocks.push({ key: `a${mid}`, kind: "assistant", text });
      continue;
    }
    if (m.role === "toolResult") {
      // Reflect an error outcome on the matching tool block, if present.
      if (m.isError) {
        const b = blocks.find((x) => x.kind === "tool" && x.key === `tool${m.toolCallId ?? ""}`);
        if (b && b.kind === "tool") b.status = "error";
      }
    }
  }
  return blocks;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => (c as { type?: string })?.type === "text")
    .map((c) => (c as { text?: string }).text ?? "")
    .join("");
}

export function createPiEventMapper(): (event: unknown) => ChatStreamEvent | null {
  let assistantId = 0;

  return (event: unknown): ChatStreamEvent | null => {
    const ev = event as {
      type: string;
      message?: { role?: string };
      assistantMessageEvent?: { type?: string; partial?: unknown };
      toolName?: string;
      toolCallId?: string;
      isError?: boolean;
      args?: unknown;
    };
    switch (ev.type) {
      case "message_start":
        if (ev.message?.role === "assistant") assistantId++;
        return null;
      case "message_update": {
        const ame = ev.assistantMessageEvent;
        if (!ame) return null;
        if (assistantId === 0) assistantId = 1;
        const kind = ame.type ?? "";
        if (kind.startsWith("text")) {
          return { type: "assistant", id: assistantId, text: fullContent(ame.partial, "text") };
        }
        if (kind.startsWith("thinking")) {
          return { type: "thinking", id: assistantId, text: fullContent(ame.partial, "thinking") };
        }
        return null;
      }
      case "tool_execution_start": {
        let args = "";
        try {
          args = ev.args ? JSON.stringify(ev.args) : "";
        } catch {
          args = "";
        }
        return { type: "tool_start", toolCallId: ev.toolCallId ?? "", toolName: ev.toolName ?? "", args: args.slice(0, 400) };
      }
      case "tool_execution_end":
        return { type: "tool_end", toolCallId: ev.toolCallId ?? "", toolName: ev.toolName ?? "", isError: !!ev.isError };
      case "agent_end":
        return { type: "agent_end" };
      default:
        return null;
    }
  };
}
