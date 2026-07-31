"use client";

import * as React from "react";
import { useStore } from "@/lib/client/store";

// Live tail of the session daily log, fed by SSE log events.
export function LogTail({ sessionId }: { sessionId: string }) {
  const { subscribeLog } = useStore();
  const [lines, setLines] = React.useState<string[]>([]);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setLines([]);
    const unsub = subscribeLog(sessionId, (line) => {
      setLines((prev) => [...prev.slice(-300), line]);
    });
    return unsub;
  }, [sessionId, subscribeLog]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div className="h-full overflow-y-auto bg-secondary/30 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
      {lines.length === 0 ? (
        <div className="text-muted-foreground">No log output yet.</div>
      ) : (
        lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {l}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}
