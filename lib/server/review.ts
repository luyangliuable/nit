import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionConfig, ReviewVerdict, ModelSelection, ChatStreamEvent, ChangeVisualization } from "@/lib/shared/types";
import { filterDiff, validRightLines } from "@/lib/core/diff";
import {
  buildReviewPrompt,
  buildVisualizationPrompt,
} from "@/lib/core/prompt";
import { parseVisualization, deterministicVisualization } from "@/lib/core/visualization";
import { validateSuggestion } from "@/lib/core/review-coverage";
import { prDiff } from "./gh";
import { runReadOnlyPrompt } from "./pi";
import { createPrReviewContext, fetchPrOverview } from "./gh-tools";
import { prepareWorktree } from "./worktree";
import { visualizationFile, prDir, ensureDir, WORKSPACE_ROOT, ensureWorkspaceRoot } from "./paths";
import { resolveAppendRequiredContext } from "./required-context";
import type { PrListItem } from "./gh";

export interface ReviewResult {
  verdict?: ReviewVerdict;
  diff: string;
  error?: string;
}

function resolveReadPath(cwd: string, p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(cwd, p);
}

// Fetch, filter and cap the diff exactly as pr-review-bot.sh does, then run the
// read only review sub session and parse the verdict. Posting is deferred to
// human approval, so this never touches GitHub write APIs.
export async function reviewPr(
  config: SessionConfig,
  pr: PrListItem,
  opts?: {
    signal?: AbortSignal;
    modelOverride?: ModelSelection;
    onLog?: (msg: string) => void;
    onStream?: (event: ChatStreamEvent) => void;
    sessionDir?: string;
  },
): Promise<ReviewResult> {
  const rawDiff = await prDiff(config.repo, pr.number);
  if (rawDiff === null) {
    return { diff: "", error: "diff-fetch-failed" };
  }

  let diff = filterDiff(rawDiff, 2000);
  if (Buffer.byteLength(diff, "utf8") > config.diffCapBytes) {
    diff =
      diff.slice(0, config.diffCapBytes) +
      `\n\n[diff truncated at ${config.diffCapBytes} bytes]`;
  }

  const model = opts?.modelOverride ?? config.reviewModel ?? config.model;

  // Check out the PR head in a per-PR worktree (shared clone, no re-clone) so
  // the agent can explore the whole repo with its native read/grep/find/ls
  // tools. Fall back to the configured cwd if the checkout fails.
  const localPath = config.localPath && config.localPath.trim() !== "" ? config.localPath : undefined;
  let cwd = localPath ?? ensureWorkspaceRoot();
  try {
    cwd = await prepareWorktree(config.repo, pr.number, pr.headRefOid, localPath);
  } catch (err) {
    opts?.onLog?.(`worktree-prep-failed ${String(err)} (exploring without a checkout)`);
  }

  // Front load the PR overview (metadata, changed files, commits, prior reviews
  // and comments) so the agent has context without a round trip.
  let overview = "";
  try {
    overview = await fetchPrOverview(config.repo, pr.number);
  } catch (err) {
    opts?.onLog?.(`overview-fetch-failed ${String(err)}`);
  }

  // Tool-driven review: the agent reviews every changed file (tracked) and
  // records suggestions incrementally, validated against the diff on the spot;
  // submit_review is gated on full coverage and produces the verdict.
  const valid = validRightLines(diff);
  const ctx = createPrReviewContext(config.repo, pr.number, rawDiff, (sug) => validateSuggestion(valid, sug));
  let changedFiles = "";
  try {
    changedFiles = await ctx.manifest();
  } catch (err) {
    opts?.onLog?.(`changed-files-manifest-failed ${String(err)}`);
  }

  const prompt = buildReviewPrompt({
    repo: config.repo,
    pr: pr.number,
    title: pr.title,
    overview,
    changedFiles,
    hasCheckout: cwd !== WORKSPACE_ROOT,
    append: config.appendPrompt,
  });

  try {
    await runReadOnlyPrompt({
      prompt,
      cwd,
      model,
      skills: config.skills,
      signal: opts?.signal,
      label: `#${pr.number}`,
      onLog: opts?.onLog,
      onStream: opts?.onStream,
      sessionDir: opts?.sessionDir,
      customTools: ctx.tools,
      // Force the model to actually read loaded skills and any explicit docs /
      // skill files referenced in the append prompt before PR diffs are shown
      // or submit_review can succeed.
      onSkillsLoaded: (skills) => {
        const appendContext = resolveAppendRequiredContext({
          appendPrompt: config.appendPrompt,
          cwd,
          loadedSkills: skills,
        });
        for (const ref of appendContext.unresolved) {
          opts?.onLog?.(`append-context-unresolved ${ref}`);
        }
        const loadedSkillPaths = skills.map((s) => s.filePath).filter(Boolean);
        const required = [...new Set([...loadedSkillPaths, ...appendContext.paths])];
        ctx.setRequiredReads(required);
        opts?.onLog?.(`required-context files=${required.length}${appendContext.paths.length ? ` append=${appendContext.paths.length}` : ""}`);
      },
      onToolExecuted: (name, args, isError) => {
        if (isError || name !== "read") return;
        const p = (args as { path?: unknown } | undefined)?.path;
        if (typeof p !== "string" || p.trim() === "") return;
        ctx.markRead(resolveReadPath(cwd, p));
      },
      finalize: {
        completed: ctx.completed,
        maxFollowUps: Math.max(0, (config.maxAttempts || 1) - 1),
        isComplete: async () => ctx.getVerdict() !== null,
        reminder: async () => {
          const unread = ctx.unreadRequired();
          if (unread.length > 0) {
            return `Before anything else you MUST read the loaded skill/context file(s) in full with the read tool: ${unread.join(", ")}. Read them, follow their guidance, then continue reviewing and call submit_review().`;
          }
          const rem = await ctx.remaining();
          return rem.length > 0
            ? `You have not reviewed these files yet: ${rem.join(", ")}. Review each with next_pr_file()/pr_file_diff(path), add any suggestions, then call submit_review().`
            : "All files are reviewed. Add any final suggestions, then call submit_review({ decision, summary }) to finish.";
        },
      },
    });
  } catch (err) {
    return { diff, error: `review-run-failed: ${String(err)}` };
  }

  const verdict = ctx.getVerdict();
  if (verdict) return { verdict, diff };
  return { diff, error: opts?.signal?.aborted ? "stopped" : "no-verdict-submitted" };
}

// Generate the change visualization for a PR and save it as JSON. Uses the diff
// already fetched during review when provided, otherwise fetches a fresh one so
// it can also run standalone (the Regenerate action).
export async function generateVisualization(
  config: SessionConfig,
  pr: PrListItem,
  diff?: string,
): Promise<{ visualization?: ChangeVisualization; error?: string }> {
  let reviewDiff = diff;
  if (!reviewDiff || reviewDiff.trim() === "") {
    const raw = await prDiff(config.repo, pr.number);
    if (raw === null) return { error: "diff-fetch-failed" };
    reviewDiff = filterDiff(raw, 2000);
    if (Buffer.byteLength(reviewDiff, "utf8") > config.diffCapBytes) {
      reviewDiff =
        reviewDiff.slice(0, config.diffCapBytes) +
        `\n\n[diff truncated at ${config.diffCapBytes} bytes]`;
    }
  }

  const cwd = config.localPath && config.localPath.trim() !== "" ? config.localPath : ensureWorkspaceRoot();
  // Always visualize with the review model to keep configuration simple.
  const model = config.reviewModel ?? config.model;

  const prompt = buildVisualizationPrompt({
    repo: config.repo,
    pr: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    diff: reviewDiff,
  });

  let text: string;
  try {
    text = await runReadOnlyPrompt({ prompt, cwd, model, skills: [] });
  } catch (err) {
    return { error: `visualization-run-failed: ${String(err)}` };
  }

  const visualization =
    parseVisualization(text) ?? deterministicVisualization(reviewDiff, `PR #${pr.number}`);
  ensureDir(prDir(config.id, pr.number));
  const file = visualizationFile(config.id, pr.number, pr.headRefOid);
  fs.writeFileSync(file, JSON.stringify(visualization), "utf8");
  return { visualization };
}
