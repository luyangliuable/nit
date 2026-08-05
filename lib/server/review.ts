import fs from "node:fs";
import type { SessionConfig, ReviewVerdict, ModelSelection, ChatStreamEvent } from "@/lib/shared/types";
import { filterDiff } from "@/lib/core/diff";
import {
  buildReviewPrompt,
  buildVisualizationPrompt,
  extractHtmlDocument,
} from "@/lib/core/prompt";
import { parseVerdict } from "@/lib/core/verdict";
import { prDiff } from "./gh";
import { runReadOnlyPrompt } from "./pi";
import { createPrReviewTools, fetchPrOverview } from "./gh-tools";
import { prepareWorktree } from "./worktree";
import { visualizationFile, prDir, ensureDir, rawVerdictFile } from "./paths";
import type { PrListItem } from "./gh";

export interface ReviewResult {
  verdict?: ReviewVerdict;
  diff: string;
  error?: string;
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
  let cwd = localPath ?? process.cwd();
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

  const prompt = buildReviewPrompt({
    repo: config.repo,
    pr: pr.number,
    title: pr.title,
    overview,
    hasCheckout: cwd !== process.cwd(),
    append: config.appendPrompt,
  });

  // The agent pulls the exact changes on demand via these read only tools; we
  // still keep `diff` server side for comment validation and the visualization.
  const prTools = createPrReviewTools(config.repo, pr.number);

  // Retry on empty/unparseable output, up to maxAttempts, appending a
  // corrective instruction after the first miss. This is what makes the
  // maxAttempts config actually do something.
  const maxAttempts = Math.max(1, config.maxAttempts || 1);
  const corrective =
    "\n\nIMPORTANT: Your previous reply could not be parsed. Reply with ONLY the JSON " +
    "object described above, valid JSON, with every newline inside a string escaped as \\n. " +
    "No prose, no explanation, no markdown code fences.";

  let lastError = "invalid-verdict-json";
  let lastText = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let text: string;
    try {
      text = await runReadOnlyPrompt({
        prompt: attempt === 1 ? prompt : prompt + corrective,
        cwd,
        model,
        skills: config.skills,
        signal: opts?.signal,
        label: `#${pr.number}${maxAttempts > 1 ? ` a${attempt}/${maxAttempts}` : ""}`,
        onLog: opts?.onLog,
        onStream: opts?.onStream,
        sessionDir: opts?.sessionDir,
        customTools: prTools,
      });
    } catch (err) {
      lastError = `review-run-failed: ${String(err)}`;
      // Do not retry a user-initiated stop.
      if (opts?.signal?.aborted) return { diff, error: lastError };
      continue;
    }

    const verdict = parseVerdict(text);
    if (verdict) return { verdict, diff };

    lastText = text;
    lastError = "invalid-verdict-json";
    opts?.onLog?.(`attempt ${attempt}/${maxAttempts} invalid-verdict-json rawLen=${text.length}`);
    if (opts?.signal?.aborted) return { diff, error: lastError };
  }

  // Persist the last raw output so the failure can be inspected.
  try {
    ensureDir(prDir(config.id, pr.number));
    fs.writeFileSync(rawVerdictFile(config.id, pr.number, pr.headRefOid), lastText, "utf8");
    opts?.onLog?.(`saved raw output to ${rawVerdictFile(config.id, pr.number, pr.headRefOid)}`);
  } catch {
    /* best effort */
  }
  return { diff, error: lastError };
}

// Generate the HTML visualization for a PR and save it, returning the file path
// on success. Uses the diff already fetched during review to avoid a second
// gh call.
export async function generateVisualization(
  config: SessionConfig,
  pr: PrListItem,
  diff: string,
): Promise<{ path?: string; error?: string }> {
  if (!diff) return { error: "no-diff" };
  const cwd = config.localPath && config.localPath.trim() !== "" ? config.localPath : process.cwd();
  // Always visualize with the review model to keep configuration simple.
  const model = config.reviewModel ?? config.model;

  const prompt = buildVisualizationPrompt({
    repo: config.repo,
    pr: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    diff,
  });

  let text: string;
  try {
    text = await runReadOnlyPrompt({ prompt, cwd, model, skills: [] });
  } catch (err) {
    return { error: `visualization-run-failed: ${String(err)}` };
  }

  const html = extractHtmlDocument(text) ?? deterministicFallback(pr, diff);
  ensureDir(prDir(config.id, pr.number));
  const file = visualizationFile(config.id, pr.number, pr.headRefOid);
  fs.writeFileSync(file, html, "utf8");
  return { path: file };
}

// Simple flat, non gradient fallback used when the model output is not valid
// HTML. Keeps the reviewer unblocked.
function deterministicFallback(pr: PrListItem, diff: string): string {
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>PR #${pr.number}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color: #1a1f2b; background: #ffffff; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #5b6472; font-size: 13px; margin-bottom: 16px; }
  pre { background: #f4f6f8; border: 1px solid #dfe3e8; border-radius: 6px; padding: 12px; overflow: auto; font-size: 12px; }
</style></head>
<body>
  <h1>${escape(pr.title)}</h1>
  <div class="meta">PR #${pr.number} by ${escape(pr.author.login)}</div>
  <pre>${escape(diff.slice(0, 20000))}</pre>
</body>
</html>`;
}
