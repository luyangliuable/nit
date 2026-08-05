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
    case "tool_end":
      return upsertBlock(prev, {
        key: `tool${ev.toolCallId}`,
        kind: "tool",
        name: ev.toolName,
        args: "",
        status: ev.isError ? "error" : "done",
      });
    case "error":
      return [...prev, { key: `e${Date.now()}`, kind: "error", text: ev.message }];
    default:
      return prev;
  }
}

export function BlockView({ block }: { block: Block }) {
  if (block.kind === "thinking") {
    return (
      <details className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium">Thinking</summary>
        <div className="mt-1 whitespace-pre-wrap">{block.text}</div>
      </details>
    );
  }
  if (block.kind === "tool") {
    const icon =
      block.status === "running" ? (
        <FiTool className="h-3.5 w-3.5 animate-pulse" />
      ) : block.status === "error" ? (
        <FiX className="h-3.5 w-3.5 text-destructive" />
      ) : (
        <FiCheck className="h-3.5 w-3.5 text-success" />
      );
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="font-medium text-foreground">{block.name}</span>
        {block.args && (
          <span className="inline-flex items-center gap-1 truncate">
            <FiChevronRight className="h-3 w-3" />
            <code className="truncate">{block.args}</code>
          </span>
        )}
        {block.status === "running" && <span>running</span>}
      </div>
    );
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
