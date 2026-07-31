"use client";

import { useStore } from "@/lib/client/store";
import { TopBar } from "@/components/top-bar";
import { TabBar } from "@/components/tab-bar";
import { Workspace } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function Home() {
  const { sessions, activeId, createSession } = useStore();
  const active = sessions.find((s) => s.config.id === activeId);

  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <TabBar />
      <main className="min-h-0 flex-1">
        {active ? (
          <Workspace key={active.config.id} snapshot={active} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Logo className="text-3xl" />
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a workspace to watch a repository for pull requests, review incoming
              changes, and implement fixes with the pi coding agent.
            </p>
            <Button onClick={() => void createSession()}>New workspace</Button>
          </div>
        )}
      </main>
    </div>
  );
}
