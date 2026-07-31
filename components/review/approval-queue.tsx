"use client";

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
}: {
  items: ApprovalItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        No pull requests reviewed yet. Start the poller to watch for incoming PRs.
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
        </button>
      ))}
    </div>
  );
}
