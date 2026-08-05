import fs from "node:fs";
import type { SessionConfig, ReviewVerdict, ModelSelection } from "@/lib/shared/types";
import { filterDiff } from "@/lib/core/diff";
import {
  buildReviewPrompt,
  buildVisualizationPrompt,
  extractHtmlDocument,
} from "@/lib/core/prompt";
import { parseVerdict } from "@/lib/core/verdict";
import { prDiff } from "./gh";
import { runReadOnlyPrompt } from "./pi";
import { visualizationFile, prDir, ensureDir } from "./paths";
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

  const cwd = config.localPath && config.localPath.trim() !== "" ? config.localPath : process.cwd();
  const model = opts?.modelOverride ?? config.reviewModel ?? config.model;

  const prompt = buildReviewPrompt({
    repo: config.repo,
    pr: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    diff,
    append: config.appendPrompt,
  });

  let text: string;
  try {
    text = await runReadOnlyPrompt({
      prompt,
      cwd,
      model,
      skills: config.skills,
      signal: opts?.signal,
      label: `#${pr.number}`,
      onLog: opts?.onLog,
    });
  } catch (err) {
    return { diff, error: `review-run-failed: ${String(err)}` };
  }

  const verdict = parseVerdict(text);
  if (!verdict) {
    return { diff, error: "invalid-verdict-json" };
  }
  return { verdict, diff };
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
  const model = config.visualizationModel ?? config.model;

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
