"use client";

import * as React from "react";
import { FiCheck, FiTrash2, FiEdit2, FiRotateCcw, FiExternalLink } from "react-icons/fi";
import type { ApprovalItem, SessionSnapshot } from "@/lib/shared/types";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import { toast } from "sonner";

export function VerdictView({ snapshot, item }: { snapshot: SessionSnapshot; item: ApprovalItem }) {
  const { action } = useStore();
  const id = snapshot.config.id;
  const [html, setHtml] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const prUrl = `https://github.com/${snapshot.config.repo}/pull/${item.pr}`;

  React.useEffect(() => {
    setHtml(null);
    if (item.hasVisualization) {
      void api.visualization(id, item.pr, item.sha).then(setHtml);
    }
  }, [id, item.pr, item.sha, item.hasVisualization]);

  const terminal = item.status === "approved" || item.status === "posted" || item.status === "dismissed";
  const keptCount = item.comments.filter((c) => c.status !== "deleted").length;

  async function run(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    const res = await action(id, body);
    setBusy(false);
    if (res.error) toast.error(res.error);
    else toast.success(okMsg);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold">#{item.pr}</span>
          <span className="truncate text-sm text-muted-foreground">{item.title}</span>
        </div>
        <a href={prUrl} target="_blank" rel="noreferrer" className="shrink-0">
          <Button variant="ghost" size="sm">
            <FiExternalLink className="h-3.5 w-3.5" /> GitHub
          </Button>
        </a>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {item.status === "reviewing" && (
          <div className="p-4 text-sm text-muted-foreground">Reviewing changes...</div>
        )}
        {item.status === "error" && (
          <div className="p-4 text-sm text-destructive">Review failed: {item.error}</div>
        )}

        {item.decision && (
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <Badge variant={item.decision === "approve" ? "success" : "warning"}>
                {item.decision === "approve" ? "Approve" : "Suggestions"}
              </Badge>
              <p className="text-sm">{item.summary}</p>
            </div>

            {html && (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Change visualization
                </div>
                <iframe
                  title={`PR ${item.pr} visualization`}
                  sandbox=""
                  srcDoc={html}
                  className="h-[460px] w-full bg-white"
                />
              </div>
            )}

            {item.comments.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Suggested comments ({keptCount} of {item.comments.length} kept)
                </div>
                {item.comments.map((c) => (
                  <CommentCard
                    key={c.id}
                    sessionId={id}
                    itemKey={item.key}
                    comment={c}
                    disabled={terminal}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!terminal && item.decision && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          {item.decision === "approve" ? (
            <Button variant="success" disabled={busy} onClick={() => run({ action: "approve", key: item.key }, "Approved on GitHub")}>
              <FiCheck className="h-4 w-4" /> Approve on GitHub
            </Button>
          ) : (
            <Button variant="success" disabled={busy || keptCount === 0} onClick={() => run({ action: "post_suggestions", key: item.key }, "Suggestions posted")}>
              <FiCheck className="h-4 w-4" /> Post {keptCount} suggestion(s)
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => run({ action: "dismiss", key: item.key }, "Dismissed")}>
            Dismiss
          </Button>
        </div>
      )}
      {terminal && (
        <div className="shrink-0 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          This review is closed. Nothing further will be posted for this commit.
        </div>
      )}
    </div>
  );
}

function CommentCard({
  sessionId,
  itemKey,
  comment,
  disabled,
}: {
  sessionId: string;
  itemKey: string;
  comment: ApprovalItem["comments"][number];
  disabled: boolean;
}) {
  const { action } = useStore();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(comment.body);
  const deleted = comment.status === "deleted";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <code className="text-xs text-muted-foreground">
          {comment.path}:{comment.line}
        </code>
        {!disabled && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setEditing((e) => !e)}
              aria-label="Edit"
            >
              <FiEdit2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => void action(sessionId, { action: "keep_comment", key: itemKey, commentId: comment.id, keep: deleted })}
              aria-label={deleted ? "Restore" : "Delete"}
            >
              {deleted ? <FiRotateCcw className="h-3 w-3" /> : <FiTrash2 className="h-3 w-3" />}
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs" />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                void action(sessionId, { action: "edit_comment", key: itemKey, commentId: comment.id, body: draft });
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(comment.body); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className={deleted ? "text-xs text-muted-foreground line-through" : "text-xs"}>{comment.body}</p>
      )}
    </div>
  );
}
