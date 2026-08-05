"use client";

import * as React from "react";
import Link from "next/link";
import { FiCheck, FiTrash2, FiEdit2, FiRotateCcw, FiExternalLink, FiRefreshCw, FiSquare, FiChevronDown } from "react-icons/fi";
import type { ApprovalItem, SessionSnapshot, ModelSelection, ReviewOverrides } from "@/lib/shared/types";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { ModelPicker } from "../model-picker";
import { cn } from "../ui/utils";
import { toast } from "sonner";

export function VerdictView({ snapshot, item }: { snapshot: SessionSnapshot; item: ApprovalItem }) {
  const { action } = useStore();
  const id = snapshot.config.id;
  const [html, setHtml] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [vizHeight, setVizHeight] = React.useState<number>();
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const prUrl = `https://github.com/${snapshot.config.repo}/pull/${item.pr}`;

  React.useEffect(() => {
    setHtml(null);
    setVizHeight(undefined);
    if (item.hasVisualization) {
      void api.visualization(id, item.pr, item.sha).then(setHtml);
    }
  }, [id, item.pr, item.sha, item.hasVisualization]);

  // Size the sandboxed iframe to its own content instead of a fixed height.
  // allow-same-origin lets the parent read the document height; scripts stay
  // disabled so the model generated HTML remains inert.
  const measureViz = React.useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const h = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    );
    if (h > 0) setVizHeight(h + 2);
  }, []);

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
        <div className="flex shrink-0 items-center gap-1">
          <ReReviewControls snapshot={snapshot} item={item} />
          <a href={prUrl} target="_blank" rel="noreferrer">
            <Button variant="ghost" size="sm">
              <FiExternalLink className="h-3.5 w-3.5" /> GitHub
            </Button>
          </a>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReviewInfoPanel item={item} />
        {item.status === "reviewing" && (
          <div className="p-4 text-sm text-muted-foreground">
            Reviewing changes{item.reviewingWith ? ` with ${item.reviewingWith}` : ""}...
          </div>
        )}
        {item.status === "error" && (
          item.error === "stopped" || item.error === "interrupted" ? (
            <div className="p-4 text-sm text-muted-foreground">
              Review {item.error}. Use Re-review to run it again.
            </div>
          ) : item.error === "github-auth" ? (
            <div className="p-4 text-sm text-destructive">
              GitHub is not authenticated, so this PR could not be reviewed.{" "}
              <Link href="/settings" className="font-medium underline">Open Settings</Link> to sign in, then Re-review.
            </div>
          ) : (
            <div className="p-4 text-sm text-destructive">Review failed: {item.error}</div>
          )
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
                  ref={iframeRef}
                  title={`PR ${item.pr} visualization`}
                  sandbox="allow-same-origin"
                  srcDoc={html}
                  onLoad={measureViz}
                  scrolling="no"
                  style={{ height: vizHeight ? `${vizHeight}px` : undefined }}
                  className="block w-full bg-white"
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

// Compact summary of the models and config a review run used.
function ReviewInfoPanel({ item }: { item: ApprovalItem }) {
  const info = item.reviewInfo;
  if (!info) return null;
  const base = (n: string) => n.replace(/.*\//, "");
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 border-b border-border bg-secondary/30 px-4 py-2 text-[11px] text-muted-foreground">
      <span>
        Model: <span className="font-medium text-foreground">{info.model.model}</span> · thinking {info.model.thinking}
      </span>
      <span>Diff cap: {Math.round(info.diffCapBytes / 1000)}KB</span>
      <span>Max attempts: {info.maxAttempts}</span>
      <span>Skills: {info.skills.length > 0 ? info.skills.map(base).join(", ") : "none"}</span>
      <span>Custom prompt: {info.appendPrompt?.trim() ? "yes" : "no"}</span>
    </div>
  );
}

// Re-review / stop controls: an immediate Rerun button plus a dropdown to
// rerun with one-off overrides. Available whether the review is ongoing or
// finished.
function ReReviewControls({ snapshot, item }: { snapshot: SessionSnapshot; item: ApprovalItem }) {
  const { action, auth } = useStore();
  const id = snapshot.config.id;
  const cfg = snapshot.config;
  const reviewing = item.status === "reviewing";
  const authOk = auth ? auth.ok : true;
  const [open, setOpen] = React.useState(false);

  // Override form state, seeded with the session's current values.
  const [model, setModel] = React.useState<ModelSelection>(cfg.reviewModel ?? cfg.model);
  const [maxAttempts, setMaxAttempts] = React.useState(cfg.maxAttempts);
  const [skills, setSkills] = React.useState(cfg.skills.join("\n"));
  const [appendPrompt, setAppendPrompt] = React.useState(cfg.appendPrompt);

  // Re-seed whenever the panel opens so fields always reflect current config.
  React.useEffect(() => {
    if (!open) return;
    setModel(cfg.reviewModel ?? cfg.model);
    setMaxAttempts(cfg.maxAttempts);
    setSkills(cfg.skills.join("\n"));
    setAppendPrompt(cfg.appendPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function rerun(overrides?: ReviewOverrides) {
    void action(id, { action: "re_review", key: item.key, overrides });
    toast.success("Re-reviewing");
    setOpen(false);
  }

  return (
    <div className="relative flex items-center gap-1">
      {reviewing && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void action(id, { action: "stop_review", key: item.key });
            toast.success("Stopping review");
          }}
        >
          <FiSquare className="h-3.5 w-3.5" /> Stop
        </Button>
      )}
      <div className="flex items-center">
        <Button
          variant="outline"
          size="sm"
          className="rounded-r-none"
          disabled={reviewing || !authOk}
          title={!authOk ? "GitHub not authenticated" : undefined}
          onClick={() => rerun()}
        >
          <FiRefreshCw className="h-3.5 w-3.5" /> Rerun
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-l-none border-l-0"
          disabled={reviewing || !authOk}
          aria-label="Rerun with overrides"
          onClick={() => setOpen((o) => !o)}
        >
          <FiChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-96 space-y-3 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
            <div className="text-xs font-medium">Rerun with overrides</div>
            <ModelPicker value={model} onChange={setModel} />
            <div className="space-y-1">
              <Label>Max attempts</Label>
              <Input
                type="number"
                min={1}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label>Skills (one path per line)</Label>
              <Textarea
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                className="h-20 text-xs"
                placeholder="none"
              />
            </div>
            <div className="space-y-1">
              <Label>Append prompt</Label>
              <Textarea
                value={appendPrompt}
                onChange={(e) => setAppendPrompt(e.target.value)}
                className="h-20 text-xs"
                placeholder="none"
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={() =>
                rerun({
                  model,
                  maxAttempts,
                  skills: skills.split("\n").map((s) => s.trim()).filter(Boolean),
                  appendPrompt,
                })
              }
            >
              <FiRefreshCw className="h-3.5 w-3.5" /> Rerun with these settings
            </Button>
          </div>
        </>
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
        <code className="truncate text-xs text-muted-foreground">
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
      {comment.codeContext && comment.codeContext.length > 0 && (
        <pre className="mb-2 overflow-x-auto rounded border border-border bg-muted/40 py-1.5 text-[11px] leading-relaxed">
          {comment.codeContext.map((l) => {
            const isTarget =
              l.line >= (comment.startLine ?? comment.line) && l.line <= comment.line;
            return (
              <div
                key={l.line}
                className={cn(
                  "flex",
                  l.kind === "add" && "bg-success/10",
                  isTarget && "bg-warning/25",
                )}
              >
                <span className="w-4 shrink-0 select-none text-center text-muted-foreground">
                  {l.kind === "add" ? "+" : " "}
                </span>
                <span className="w-10 shrink-0 select-none px-2 text-right text-muted-foreground">{l.line}</span>
                <code className="whitespace-pre pr-3">{l.text || " "}</code>
              </div>
            );
          })}
        </pre>
      )}
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
