"use client";

import * as React from "react";
import { FiSend, FiSquare } from "react-icons/fi";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../ui/utils";
import { type Block, BlockView, upsertBlock, applyStreamEvent } from "../transcript";

export function Chat({ sessionId }: { sessionId: string }) {
  const { subscribeChat } = useStore();
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [commands, setCommands] = React.useState<{ name: string; description: string }[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [menuIndex, setMenuIndex] = React.useState(0);
  const endRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

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

  React.useEffect(() => {
    const unsub = subscribeChat(sessionId, (ev) => {
      if (ev.type === "assistant" || ev.type === "thinking") setStreaming(true);
      if (ev.type === "agent_end" || ev.type === "error") setStreaming(false);
      setBlocks((prev) => applyStreamEvent(prev, ev));
    });
    return unsub;
  }, [sessionId, subscribeChat]);

  React.useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
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
    setBlocks((prev) => upsertBlock(prev, { key: `u${Date.now()}`, kind: "user", text }));
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
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {blocks.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Prompt the pi coding agent to implement changes in the local clone. Type / for slash commands.
          </div>
        )}
        {blocks.map((b, i) => (
          <BlockView key={b.key} block={b} streaming={streaming} isLast={i === blocks.length - 1} />
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
