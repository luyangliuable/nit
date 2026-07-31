"use client";

import type { SessionSnapshot } from "@/lib/shared/types";
import { Chat } from "./chat";
import { GitPanel } from "./git-panel";

export function ImplementMode({ snapshot }: { snapshot: SessionSnapshot }) {
  const id = snapshot.config.id;

  if (!snapshot.config.localPath) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Set a local clone path in Review mode settings to start an Implement session.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <section className="min-w-0 flex-1 border-r border-border">
        <Chat sessionId={id} />
      </section>
      <aside className="w-80 shrink-0">
        <GitPanel sessionId={id} />
      </aside>
    </div>
  );
}
