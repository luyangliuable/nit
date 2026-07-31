"use client";

import * as React from "react";
import { FiGitBranch, FiRefreshCw, FiUpload, FiGitPullRequest } from "react-icons/fi";
import { api } from "@/lib/client/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { toast } from "sonner";

interface GitState {
  branch?: string;
  branches?: string[];
  status?: { status: string; path: string }[];
  error?: string;
}

export function GitPanel({ sessionId }: { sessionId: string }) {
  const [state, setState] = React.useState<GitState>({});
  const [diff, setDiff] = React.useState("");
  const [commitMsg, setCommitMsg] = React.useState("");
  const [newBranch, setNewBranch] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setState(await api.gitState(sessionId));
  }, [sessionId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function op(body: Record<string, unknown>, okMsg?: string) {
    setBusy(true);
    const res = await api.gitOp(sessionId, body);
    setBusy(false);
    if (res.error) toast.error(String(res.error));
    else if (okMsg) toast.success(okMsg);
    await refresh();
    return res;
  }

  if (state.error) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {state.error === "no-local-path"
          ? "Set a local clone path in Review mode settings to use git actions."
          : `Git unavailable: ${state.error}`}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <FiGitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select value={state.branch} onValueChange={(b) => void op({ op: "checkout", branch: b }, `Checked out ${b}`)}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="branch" />
          </SelectTrigger>
          <SelectContent>
            {(state.branches ?? []).map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refresh()} aria-label="Refresh">
          <FiRefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Input value={newBranch} placeholder="new-branch" className="h-8" onChange={(e) => setNewBranch(e.target.value)} />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !newBranch.trim()}
          onClick={async () => {
            await op({ op: "create_branch", branch: newBranch.trim() }, "Branch created");
            setNewBranch("");
          }}
        >
          Create
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border p-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Working tree</div>
          {(state.status ?? []).length === 0 ? (
            <div className="text-xs text-muted-foreground">Clean.</div>
          ) : (
            <div className="space-y-0.5 font-mono text-[11px]">
              {state.status!.map((s) => (
                <div key={s.path} className="flex gap-2">
                  <span className="text-warning">{s.status.trim() || "?"}</span>
                  <span className="truncate">{s.path}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => void op({ op: "stage_all" }, "Staged all")}>
              Stage all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const r = await api.gitOp(sessionId, { op: "diff", staged: false });
                setDiff(String(r.diff ?? ""));
              }}
            >
              Show diff
            </Button>
          </div>
        </div>

        {diff && (
          <pre className="max-h-64 overflow-auto border-b border-border bg-secondary/30 p-3 font-mono text-[11px] leading-relaxed">
            {diff}
          </pre>
        )}

        <div className="space-y-2 p-3">
          <Input value={commitMsg} placeholder="Commit message" className="h-8" onChange={(e) => setCommitMsg(e.target.value)} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !commitMsg.trim()}
              onClick={async () => {
                await op({ op: "commit", message: commitMsg.trim() }, "Committed");
                setCommitMsg("");
              }}
            >
              Commit
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void op({ op: "push" }, "Pushed")}>
              <FiUpload className="h-3.5 w-3.5" /> Push
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                const r = await op({ op: "open_pr", title: state.branch ?? "", body: "" });
                if (r.url) toast.success(`PR opened: ${r.url}`);
              }}
            >
              <FiGitPullRequest className="h-3.5 w-3.5" /> Open PR
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
