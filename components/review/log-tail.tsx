"use client";

import * as React from "react";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";

type Entry = { line: string; pr?: number };

// Parse the PR number a persisted log line refers to, matching the `pr=#N`
// convention the server writes. Untagged lifecycle lines return undefined.
function parsePr(line: string): number | undefined {
  const m = line.match(/\bpr=#(\d+)\b/);
  return m ? Number(m[1]) : undefined;
}

// Live tail of the session daily log. On open it backfills the persisted log so
// the full history is shown, then appends live SSE lines. When `pr` is set,
// only lines tagged with that PR are shown (strict per-PR view).
export function LogTail({ sessionId, pr }: { sessionId: string; pr?: number }) {
  const { subscribeLog } = useStore();
  const [backfill, setBackfill] = React.useState<Entry[]>([]);
  const [live, setLive] = React.useState<Entry[]>([]);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setBackfill([]);
    setLive([]);
    let cancelled = false;
    // Attach the live subscription first so nothing emitted during the fetch is
    // lost, then backfill the persisted history in front of it.
    const unsub = subscribeLog(sessionId, (line, linePr) => {
      setLive((prev) => [...prev.slice(-1000), { line, pr: linePr }]);
    });
    void api.logs(sessionId).then((lines) => {
      if (cancelled) return;
      setBackfill(lines.map((line) => ({ line, pr: parsePr(line) })));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [sessionId, subscribeLog]);

  // Combine backfill + live, dropping live lines already present in backfill
  // (boundary overlap), then apply the strict per-PR filter.
  const visible = React.useMemo(() => {
    const seen = new Set(backfill.map((e) => e.line));
    const combined = [...backfill, ...live.filter((e) => !seen.has(e.line))];
    return pr === undefined ? combined : combined.filter((e) => e.pr === pr);
  }, [backfill, live, pr]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [visible]);

  return (
    <div className="h-full overflow-y-auto bg-secondary/30 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
      {visible.length === 0 ? (
        <div className="text-muted-foreground">
          {pr === undefined ? "No log output yet." : "No log output for this PR yet."}
        </div>
      ) : (
        visible.map((e, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {e.line}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
