"use client";

import * as React from "react";
import { FiSend, FiSquare, FiTool, FiCheck, FiX, FiChevronRight } from "react-icons/fi";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Markdown } from "../markdown";
import { cn } from "../ui/utils";

// A rendered block in the transcript. Assistant and thinking blocks are keyed
// by the server assigned message id so full snapshots upsert in place and
// duplicate events never double the text.
type Block =
  | { key: string; kind: "user"; text: string }
  | { key: string; kind: "assistant"; text: string }
  | { key: string; kind: "thinking"; text: string }
  | { key: string; kind: "tool"; name: string; args: string; status: "running" | "done" | "error" }
  | { key: string; kind: "error"; text: string };

export function Chat({ sessionId }: { sessionId: string }) {
  const { subscribeChat } = useStore();
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [commands, setCommands] = React.useState<{ name: string; description: string }[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [menuIndex, setMenuIndex] = React.useState(0);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void api.chatState(sessionId).then((s) => {
      setBlocks(
        s.history.map((m, i) => ({
          key: `h${i}`,
          kind: m.role === "user" ? "user" : "assistant",
          text: m.text,
        })),
      );
      setCommands(s.commands);
    });
  }, [sessionId]);

  // Upsert a block by key: replace in place when present, append otherwise.
  const upsert = React.useCallback((block: Block) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.key === block.key);
      if (idx === -1) return [...prev, block];
      const next = [...prev];
      next[idx] = block;
      return next;
    });
  }, []);

  React.useEffect(() => {
    const unsub = subscribeChat(sessionId, (ev) => {
      switch (ev.type) {
        case "assistant":
          setStreaming(true);
          upsert({ key: `a${ev.id}`, kind: "assistant", text: ev.text });
          break;
        case "thinking":
          setStreaming(true);
          upsert({ key: `t${ev.id}`, kind: "thinking", text: ev.text });
          break;
        case "tool_start":
          upsert({ key: `tool${ev.toolCallId}`, kind: "tool", name: ev.toolName, args: ev.args, status: "running" });
          break;
        case "tool_end":
          upsert({
            key: `tool${ev.toolCallId}`,
            kind: "tool",
            name: ev.toolName,
            args: "",
            status: ev.isError ? "error" : "done",
          });
          break;
        case "agent_end":
          setStreaming(false);
          break;
        case "error":
          setStreaming(false);
          setBlocks((prev) => [...prev, { key: `e${Date.now()}`, kind: "error", text: ev.message }]);
          break;
      }
    });
    return unsub;
  }, [sessionId, subscribeChat, upsert]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [blocks]);

  const showCommands = input.startsWith("/") && !input.includes(" ");
  const matches = React.useMemo(
    () => (showCommands ? commands.filter((c) => c.name.startsWith(input.slice(1))) : []),
    [showCommands, commands, input],
  );
  React.useEffect(() => setMenuIndex(0), [input]);

  function acceptCommand(name: string) {
    setInput(`/${name} `);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setBlocks((prev) => [...prev, { key: `u${Date.now()}`, kind: "user", text }]);
    setInput("");
    await api.chatPrompt(sessionId, text);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (showCommands && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        acceptCommand(matches[menuIndex].name);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {blocks.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Prompt the pi coding agent to implement changes in the local clone. Type / for slash commands.
          </div>
        )}
        {blocks.map((b) => (
          <BlockView key={b.key} block={b} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="relative shrink-0 border-t border-border p-3">
        {matches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover">
            {matches.map((c, i) => (
              <button
                key={c.name}
                className={cn(
                  "flex w-full flex-col items-start px-3 py-1.5 text-left text-xs",
                  i === menuIndex ? "bg-accent" : "hover:bg-accent",
                )}
                onMouseEnter={() => setMenuIndex(i)}
                onClick={() => acceptCommand(c.name)}
              >
                <span className="font-medium">/{c.name}</span>
                {c.description && <span className="text-muted-foreground">{c.description}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message the coding agent"
            className="min-h-[44px] resize-none"
          />
          {streaming ? (
            <Button variant="outline" size="icon" onClick={() => void api.chatAbort(sessionId)} aria-label="Stop">
              <FiSquare className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void send()} aria-label="Send">
              <FiSend className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
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
          "max-w-[85%] rounded-md border px-3 py-2 text-sm",
          isUser ? "whitespace-pre-wrap border-border bg-primary text-primary-foreground" : "border-border bg-card",
        )}
      >
        {isUser ? block.text : <Markdown>{block.text}</Markdown>}
      </div>
    </div>
  );
}
