"use client";

import * as React from "react";
import { FiTool, FiCheck, FiX, FiChevronRight } from "react-icons/fi";
import type { ChatStreamEvent, TranscriptBlock } from "@/lib/shared/types";
import { Markdown } from "./markdown";
import { cn } from "./ui/utils";

// A rendered block in a transcript. Assistant and thinking blocks are keyed by
// the server assigned message id so full snapshots upsert in place and
// duplicate events never double the text.
export type Block = TranscriptBlock;

// Upsert a block by key: replace in place when present, append otherwise.
export function upsertBlock(prev: Block[], block: Block): Block[] {
  const idx = prev.findIndex((b) => b.key === block.key);
  if (idx === -1) return [...prev, block];
  const next = [...prev];
  next[idx] = block;
  return next;
}

// Fold a ChatStreamEvent into a blocks array. agent_end carries no block.
export function applyStreamEvent(prev: Block[], ev: ChatStreamEvent): Block[] {
  switch (ev.type) {
    case "assistant":
      return upsertBlock(prev, { key: `a${ev.id}`, kind: "assistant", text: ev.text });
    case "thinking":
      return upsertBlock(prev, { key: `t${ev.id}`, kind: "thinking", text: ev.text });
    case "tool_start":
      return upsertBlock(prev, { key: `tool${ev.toolCallId}`, kind: "tool", name: ev.toolName, args: ev.args, status: "running" });
    case "tool_end": {
      // Preserve the args captured at tool_start; add the result + final status.
      const existing = prev.find((b) => b.key === `tool${ev.toolCallId}`);
      const args = existing && existing.kind === "tool" ? existing.args : "";
      return upsertBlock(prev, {
        key: `tool${ev.toolCallId}`,
        kind: "tool",
        name: ev.toolName,
        args,
        status: ev.isError ? "error" : "done",
        result: ev.result,
      });
    }
    case "error":
      return [...prev, { key: `e${Date.now()}`, kind: "error", text: ev.message }];
    default:
      return prev;
  }
}

// First `n` words of a string, with an ellipsis when truncated.
function firstWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/);
  const head = words.slice(0, n).join(" ");
  return words.length > n ? `${head}\u2026` : head;
}

// Thinking block: expanded while streaming (active), collapsed once done with a
// first-few-words preview. Rendered as a controlled panel (not <details>) so
// streaming content reliably shows when expanded.
function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = React.useState(active);
  // Auto-expand while streaming, auto-collapse when the run finishes. Does not
  // fire on text updates, so a manual toggle sticks during streaming.
  React.useEffect(() => setOpen(active), [active]);
  const preview = firstWords(text, 10) || "Thinking";
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 text-left font-medium"
      >
        <FiChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="truncate">{open ? "Thinking" : preview}</span>
      </button>
      {open && <div className="mt-1 whitespace-pre-wrap break-words">{text}</div>}
    </div>
  );
}

// Tool call: a tick/spinner/x plus a collapsible with the call params and result.
function ToolBlock({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const [open, setOpen] = React.useState(false);
  const icon =
    block.status === "running" ? (
      <FiTool className="h-3.5 w-3.5 shrink-0 animate-pulse" />
    ) : block.status === "error" ? (
      <FiX className="h-3.5 w-3.5 shrink-0 text-destructive" />
    ) : (
      <FiCheck className="h-3.5 w-3.5 shrink-0 text-success" />
    );
  const hasDetail = Boolean(block.args || block.result);
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-2 text-left", hasDetail && "cursor-pointer")}
      >
        {hasDetail && <FiChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")} />}
        {icon}
        <span className="font-medium text-foreground">{block.name}</span>
        {block.status === "running" && <span className="ml-auto">running</span>}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {block.args && (
            <div>
              <div className="font-medium">Params</div>
              <pre className="mt-0.5 overflow-x-auto rounded bg-muted p-1.5 text-[11px]">{block.args}</pre>
            </div>
          )}
          {block.result && (
            <div>
              <div className="font-medium">Result</div>
              <pre className="mt-0.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-1.5 text-[11px]">{block.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BlockView({ block, streaming, isLast }: { block: Block; streaming?: boolean; isLast?: boolean }) {
  if (block.kind === "thinking") {
    return <ThinkingBlock text={block.text} active={!!streaming && !!isLast} />;
  }
  if (block.kind === "tool") {
    return <ToolBlock block={block} />;
  }
  if (block.kind === "error") {
    return (
      <div className="rounded-md border border-destructive bg-card px-3 py-2 text-sm text-destructive">
        {block.text}
      </div>
    );
  }
  const isUser = block.kind === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[85%] overflow-hidden break-words rounded-md border px-3 py-2 text-sm",
          isUser ? "whitespace-pre-wrap border-border bg-primary text-primary-foreground" : "border-border bg-card",
        )}
      >
        {isUser ? block.text : <Markdown>{block.text}</Markdown>}
      </div>
    </div>
  );
}
