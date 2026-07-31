"use client";

import { FiPlus, FiX } from "react-icons/fi";
import { SiGithub } from "react-icons/si";
import { useStore } from "@/lib/client/store";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";

export function TabBar() {
  const { sessions, activeId, setActiveId, createSession, deleteSession } = useStore();

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-secondary/40 px-2">
      {sessions.map((s) => {
        const active = s.config.id === activeId;
        const label = s.config.repo || s.config.name;
        return (
          <div
            key={s.config.id}
            onClick={() => setActiveId(s.config.id)}
            className={cn(
              "group flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs",
              active
                ? "border-border bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:bg-background/60",
            )}
          >
            <SiGithub className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="max-w-40 truncate">{label}</span>
            {s.pollerRunning && <span className="h-1.5 w-1.5 rounded-full bg-success" title="Polling" />}
            {s.unreadCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
                {s.unreadCount}
              </span>
            )}
            <button
              className="opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void deleteSession(s.config.id);
              }}
              aria-label="Close tab"
            >
              <FiX className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void createSession()} aria-label="New workspace">
        <FiPlus className="h-4 w-4" />
      </Button>
    </div>
  );
}
