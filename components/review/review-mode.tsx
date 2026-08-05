"use client";

import * as React from "react";
import Link from "next/link";
import { FiPlay, FiSquare, FiRefreshCw, FiSettings, FiSearch, FiTerminal } from "react-icons/fi";
import type { ApprovalItem, ApprovalStatus, SessionSnapshot } from "@/lib/shared/types";
import { useStore } from "@/lib/client/store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ApprovalQueue } from "./approval-queue";
import { VerdictView } from "./verdict-view";
import { ConfigForm } from "./config-form";
import { LogTail } from "./log-tail";
import { ReviewConsole } from "./review-console";

export type QueueFilter = "active" | "dismissed" | "all" | "reviewing" | "approved";

const FILTER_LABELS: Record<QueueFilter, string> = {
    active: "Active",
    dismissed: "Dismissed",
    all: "All",
    reviewing: "Reviewing",
    approved: "Approved",
};

const FILTER_ORDER: QueueFilter[] = ["active", "dismissed", "all", "reviewing", "approved"];

function matchesFilter(status: ApprovalStatus, filter: QueueFilter): boolean {
    switch (filter) {
        case "active":
            return status !== "dismissed";
        case "dismissed":
            return status === "dismissed";
        case "reviewing":
            return status === "reviewing";
        case "approved":
            return status === "approved" || status === "posted";
        case "all":
        default:
            return true;
    }
}

function matchesSearch(item: ApprovalItem, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
        String(item.pr).includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q)
    );
}

export function ReviewMode({ snapshot }: { snapshot: SessionSnapshot }) {
    const { action, auth } = useStore();
    const id = snapshot.config.id;
    // Treat unknown auth (before the first SSE status) as allowed to avoid a
    // flash of disabled controls; gate only when we know auth failed.
    const authOk = auth ? auth.ok : true;
    const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
    const [showConfig, setShowConfig] = React.useState(!snapshot.config.repo);
    const [showConsole, setShowConsole] = React.useState(false);
    const [filter, setFilter] = React.useState<QueueFilter>("active");
    const [search, setSearch] = React.useState("");

    const filterStorageKey = `nit:queue-filter:${id}`;

    // Restore the persisted filter for this session on mount / session change.
    React.useEffect(() => {
        const saved = window.localStorage.getItem(filterStorageKey);
        if (saved && FILTER_ORDER.includes(saved as QueueFilter)) {
            setFilter(saved as QueueFilter);
        } else {
            setFilter("active");
        }
    }, [filterStorageKey]);

    function changeFilter(next: QueueFilter) {
        setFilter(next);
        window.localStorage.setItem(filterStorageKey, next);
    }

    const counts = React.useMemo(() => {
        const c = { active: 0, dismissed: 0, all: 0, reviewing: 0, approved: 0 } as Record<QueueFilter, number>;
        for (const item of snapshot.queue) {
            for (const f of FILTER_ORDER) if (matchesFilter(item.status, f)) c[f] += 1;
        }
        return c;
    }, [snapshot.queue]);

    const visibleQueue = React.useMemo(
        () => snapshot.queue.filter((q) => matchesFilter(q.status, filter) && matchesSearch(q, search)),
        [snapshot.queue, filter, search],
    );

    const selected = visibleQueue.find((q) => q.key === selectedKey) ?? visibleQueue[0] ?? null;

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
                        <Button variant="default" size="sm" disabled={!snapshot.config.repo || !authOk} title={!authOk ? "GitHub not authenticated" : undefined} onClick={() => void action(id, { action: "start" })}>
                            <FiPlay className="h-3.5 w-3.5" /> Start
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" disabled={!snapshot.config.repo || !authOk} title={!authOk ? "GitHub not authenticated" : undefined} onClick={() => void action(id, { action: "poll_now" })}>
                        <FiRefreshCw className="h-3.5 w-3.5" /> Poll
                    </Button>
                    <Button
                        variant={showConsole ? "secondary" : "ghost"}
                        size="sm"
                        className="ml-auto"
                        onClick={() => setShowConsole((s) => !s)}
                        aria-label="Console"
                        aria-pressed={showConsole}
                    >
                        <FiTerminal className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant={showConsole ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setShowConfig((s) => !s)} aria-label="Settings">
                        <FiSettings className="h-4 w-4" />
                    </Button>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2 py-1.5">
                    <Select value={filter} onValueChange={(v) => changeFilter(v as QueueFilter)}>
                        <SelectTrigger className="h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FILTER_ORDER.map((f) => (
                                <SelectItem key={f} value={f}>
                                    {FILTER_LABELS[f]} ({counts[f]})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="relative">
                        <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search #, title, author"
                            className="h-8 pl-8 text-xs"
                        />
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <ApprovalQueue
                        items={visibleQueue}
                        selectedKey={selected?.key ?? null}
                        onSelect={setSelectedKey}
                        hasItems={snapshot.queue.length > 0}
                    />
                </div>
            </aside>

            {/* Center verdict view */}
            <section className="flex min-w-0 flex-1 flex-col">
                {!authOk && (
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
                        <span className="text-destructive">
                            GitHub not authenticated{auth?.error ? `: ${auth.error}` : ""}. Reviewing is disabled.
                        </span>
                        <Link href="/settings" className="shrink-0 font-medium text-destructive underline">
                            Open Settings
                        </Link>
                    </div>
                )}
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

            {/* Live console panel, toggled alongside the review */}
            {showConsole && (
                <aside className="flex w-96 shrink-0 flex-col border-l border-border">
                    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                        <FiTerminal className="h-3.5 w-3.5" /> Console {selected ? `· PR #${selected.pr}` : ""}
                    </div>
                    <div className="min-h-0 flex-1">
                        <ReviewConsole sessionId={id} pr={selected?.pr} runKey={selected?.updatedAt} />
                    </div>
                </aside>
            )}

            {/* Config and log panel */}
            {showConfig && (
                <aside className="flex w-80 shrink-0 flex-col border-l border-border">
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <ConfigForm snapshot={snapshot} />
                    </div>
                    <div className="h-48 shrink-0 border-t border-border">
                        <LogTail sessionId={id} pr={selected?.pr} />
                    </div>
                </aside>
            )}
        </div>
    );
}
