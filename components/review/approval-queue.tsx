"use client";

import { formatDistanceToNow } from "date-fns";
import type { ApprovalItem, ApprovalStatus } from "@/lib/shared/types";
import { Badge } from "../ui/badge";
import { cn } from "../ui/utils";

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  reviewing: "Reviewing",
  pending: "Needs review",
  approved: "Approved",
  posted: "Posted",
  dismissed: "Dismissed",
  error: "Error",
};

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

function absoluteTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleString();
}

function statusVariant(status: ApprovalStatus): "default" | "secondary" | "success" | "warning" | "destructive" | "outline" {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
    case "posted":
      return "success";
    case "error":
      return "destructive";
    case "reviewing":
      return "secondary";
    default:
      return "outline";
  }
}

export function ApprovalQueue({
  items,
  selectedKey,
  onSelect,
  hasItems = false,
}: {
  items: ApprovalItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  hasItems?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        {hasItems
          ? "No reviews match this filter or search."
          : "No pull requests reviewed yet. Start the poller to watch for incoming PRs."}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          className={cn(
            "flex flex-col gap-1 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent",
            selectedKey === item.key && "bg-accent",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">#{item.pr}</span>
            <Badge variant={statusVariant(item.status)}>{STATUS_LABEL[item.status]}</Badge>
          </div>
          <span className="truncate text-xs text-muted-foreground">{item.title}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{item.author}</span>
            {item.decision && <span>{item.decision === "approve" ? "lgtm" : `${item.comments.filter((c) => c.status !== "deleted").length} suggestions`}</span>}
          </div>
          <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {item.createdAt && <span title={absoluteTime(item.createdAt)}>Created {formatRelativeTime(item.createdAt)}</span>}
            {item.lastCommitDate && <span title={absoluteTime(item.lastCommitDate)}>Last commit {formatRelativeTime(item.lastCommitDate)}</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
