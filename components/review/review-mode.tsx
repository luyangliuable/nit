"use client";

import * as React from "react";
import { FiPlay, FiSquare, FiRefreshCw, FiSettings } from "react-icons/fi";
import type { SessionSnapshot } from "@/lib/shared/types";
import { useStore } from "@/lib/client/store";
import { Button } from "../ui/button";
import { ApprovalQueue } from "./approval-queue";
import { VerdictView } from "./verdict-view";
import { ConfigForm } from "./config-form";
import { LogTail } from "./log-tail";

export function ReviewMode({ snapshot }: { snapshot: SessionSnapshot }) {
  const { action } = useStore();
  const id = snapshot.config.id;
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [showConfig, setShowConfig] = React.useState(!snapshot.config.repo);

  const selected = snapshot.queue.find((q) => q.key === selectedKey) ?? snapshot.queue[0] ?? null;

  React.useEffect(() => {
    if (snapshot.unreadCount > 0) void action(id, { action: "mark_read" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.unreadCount, id]);

  return (
    <div className="flex h-full">
      {/* Approval queue */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
          {snapshot.pollerRunning ? (
            <Button variant="outline" size="sm" onClick={() => void action(id, { action: "stop" })}>
              <FiSquare className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button variant="default" size="sm" disabled={!snapshot.config.repo} onClick={() => void action(id, { action: "start" })}>
              <FiPlay className="h-3.5 w-3.5" /> Start
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!snapshot.config.repo} onClick={() => void action(id, { action: "poll_now" })}>
            <FiRefreshCw className="h-3.5 w-3.5" /> Poll
          </Button>
          <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => setShowConfig((s) => !s)} aria-label="Settings">
            <FiSettings className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ApprovalQueue items={snapshot.queue} selectedKey={selected?.key ?? null} onSelect={setSelectedKey} />
        </div>
      </aside>

      {/* Center verdict view */}
      <section className="min-w-0 flex-1">
        {selected ? (
          <VerdictView snapshot={snapshot} item={selected} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {snapshot.config.repo
              ? "Waiting for pull requests. Reviews will appear here for your approval."
              : "Set a repository in settings to begin."}
          </div>
        )}
      </section>

      {/* Config and log panel */}
      {showConfig && (
        <aside className="flex w-80 shrink-0 flex-col border-l border-border">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ConfigForm snapshot={snapshot} />
          </div>
          <div className="h-48 shrink-0 border-t border-border">
            <LogTail sessionId={id} />
          </div>
        </aside>
      )}
    </div>
  );
}
