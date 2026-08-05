"use client";

import * as React from "react";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { type Block, BlockView, applyStreamEvent } from "../transcript";
import { LogTail } from "./log-tail";

// Per-PR review console. Shows a live transcript of the review pi session
// (thinking, response, tool calls) for the selected PR, streamed over SSE and
// seeded from the server side buffer, plus the strict per-PR lifecycle log.
export function ReviewConsole({ sessionId, pr, runKey }: { sessionId: string; pr?: number; runKey?: string }) {
  const { subscribeReviewStream } = useStore();
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const endRef = React.useRef<HTMLDivElement>(null);

  // Seed from the persisted transcript whenever the selected PR changes or a
  // new review run starts/finishes (runKey), so a rerun clears stale blocks.
  React.useEffect(() => {
    setBlocks([]);
    if (pr === undefined) return;
    let cancelled = false;
    void api.reviewTranscript(sessionId, pr).then((blocks) => {
      if (!cancelled) setBlocks(blocks);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, pr, runKey]);

  // Apply live stream events for the selected PR.
  React.useEffect(() => {
    if (pr === undefined) return;
    const unsub = subscribeReviewStream(sessionId, (streamPr, ev) => {
      if (streamPr !== pr) return;
      setBlocks((prev) => applyStreamEvent(prev, ev));
    });
    return unsub;
  }, [sessionId, pr, subscribeReviewStream]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [blocks]);

  if (pr === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select a PR to see its review console.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {blocks.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No review activity yet. Start or re-review this PR to stream thinking, response, and tool calls.
          </div>
        ) : (
          blocks.map((b) => <BlockView key={b.key} block={b} />)
        )}
        <div ref={endRef} />
      </div>
      <details className="shrink-0 border-t border-border">
        <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Log
        </summary>
        <div className="h-40 border-t border-border">
          <LogTail sessionId={sessionId} pr={pr} />
        </div>
      </details>
    </div>
  );
}
