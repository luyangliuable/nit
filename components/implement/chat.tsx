"use client";

import * as React from "react";
import { FiSend, FiSquare } from "react-icons/fi";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../ui/utils";

interface Msg {
  role: string;
  text: string;
}

export function Chat({ sessionId }: { sessionId: string }) {
  const { subscribeChat } = useStore();
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [commands, setCommands] = React.useState<{ name: string; description: string }[]>([]);
  const [input, setInput] = React.useState("");
  const [streaming, setStreaming] = React.useState(false);
  const [tool, setTool] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    void api.chatState(sessionId).then((s) => {
      setMessages(s.history);
      setCommands(s.commands);
    });
  }, [sessionId]);

  React.useEffect(() => {
    const unsub = subscribeChat(sessionId, (ev) => {
      switch (ev.type) {
        case "message_start":
          setStreaming(true);
          setMessages((prev) => [...prev, { role: "assistant", text: "" }]);
          break;
        case "text_delta":
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") last.text += ev.delta;
            else next.push({ role: "assistant", text: ev.delta });
            return next;
          });
          break;
        case "tool_start":
          setTool(ev.toolName);
          break;
        case "tool_end":
          setTool(null);
          break;
        case "agent_end":
          setStreaming(false);
          setTool(null);
          break;
        case "error":
          setStreaming(false);
          setMessages((prev) => [...prev, { role: "error", text: ev.message }]);
          break;
      }
    });
    return unsub;
  }, [sessionId, subscribeChat]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, tool]);

  const showCommands = input.startsWith("/") && !input.includes(" ");
  const matches = commands.filter((c) => c.name.startsWith(input.slice(1)));

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    await api.chatPrompt(sessionId, text);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Prompt the pi coding agent to implement changes in the local clone. Type / for slash commands.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-md border px-3 py-2 text-sm",
                m.role === "user" && "border-border bg-primary text-primary-foreground",
                m.role === "assistant" && "border-border bg-card",
                m.role === "error" && "border-destructive bg-card text-destructive",
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {tool && (
          <div className="text-xs text-muted-foreground">Running tool: {tool}</div>
        )}
        <div ref={endRef} />
      </div>

      <div className="relative shrink-0 border-t border-border p-3">
        {showCommands && matches.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover">
            {matches.map((c) => (
              <button
                key={c.name}
                className="flex w-full flex-col items-start px-3 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => setInput(`/${c.name} `)}
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
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
