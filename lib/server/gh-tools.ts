import { Type } from "typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getOctokit } from "./octokit";

// GitHub PR context for the review agent. The high level overview is front
// loaded into the prompt (fetchPrOverview); the agent then explores the full
// repo via the worktree checkout (native read/grep/find/ls) and pulls the exact
// changes on demand via the read only pr_diff / pr_file_diff tools below.

type TextResult = { content: { type: "text"; text: string }[]; details: unknown };

function text(body: string): TextResult {
  return { content: [{ type: "text", text: body }], details: {} };
}

interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

const DIFF_CAP = 60000;

async function listPrFiles(repo: string, pr: number): Promise<PrFile[]> {
  const [owner, name] = repo.split("/");
  const o = await getOctokit();
  return o.paginate(o.rest.pulls.listFiles, { owner, repo: name, pull_number: pr, per_page: 100 });
}

// Build the high level PR overview (metadata, changed files, commits, existing
// reviews and inline comments) as a JSON string to front load into the prompt.
export async function fetchPrOverview(repo: string, pr: number): Promise<string> {
  const [owner, name] = repo.split("/");
  const o = await getOctokit();
  const [pull, files, commits, reviews, comments] = await Promise.all([
    o.rest.pulls.get({ owner, repo: name, pull_number: pr }),
    listPrFiles(repo, pr),
    o.paginate(o.rest.pulls.listCommits, { owner, repo: name, pull_number: pr, per_page: 100 }),
    o.paginate(o.rest.pulls.listReviews, { owner, repo: name, pull_number: pr, per_page: 100 }),
    o.paginate(o.rest.pulls.listReviewComments, { owner, repo: name, pull_number: pr, per_page: 100 }),
  ]);
  const overview = {
    title: pull.data.title,
    description: pull.data.body ?? "",
    author: pull.data.user?.login ?? "",
    state: pull.data.state,
    draft: pull.data.draft ?? false,
    base: pull.data.base.ref,
    head: pull.data.head.ref,
    headSha: pull.data.head.sha,
    files: files.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
    })),
    commits: commits.map((c) => ({
      sha: c.sha.slice(0, 12),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name ?? c.author?.login ?? "",
      date: c.commit.author?.date ?? "",
    })),
    reviews: reviews.map((r) => ({
      author: r.user?.login ?? "",
      state: r.state,
      body: r.body ?? "",
      submittedAt: r.submitted_at ?? "",
    })),
    reviewComments: comments.map((c) => ({
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      author: c.user?.login ?? "",
      body: c.body,
    })),
  };
  return JSON.stringify(overview, null, 2);
}

export function createPrReviewTools(repo: string, pr: number): ToolDefinition[] {
  // Cache the files listing (with patches) across tool calls in a review.
  let filesCache: Promise<PrFile[]> | null = null;
  const files = () => (filesCache ??= listPrFiles(repo, pr));

  const prDiff: ToolDefinition = {
    name: "pr_diff",
    label: "PR diff",
    description:
      "Get the unified diff of the whole pull request (all changed files). Only lines that appear " +
      "here on the RIGHT side are commentable. Large diffs are truncated; use pr_file_diff for a " +
      "specific file when truncated.",
    parameters: Type.Object({}),
    execute: async (): Promise<TextResult> => {
      const all = await files();
      let out = "";
      let truncated = false;
      for (const f of all) {
        const header = `diff --git a/${f.previous_filename ?? f.filename} b/${f.filename} (${f.status})\n`;
        const body = f.patch ? f.patch + "\n" : "(no textual diff: binary or too large)\n";
        if (out.length + header.length + body.length > DIFF_CAP) {
          truncated = true;
          break;
        }
        out += header + body;
      }
      if (truncated) out += `\n[diff truncated at ${DIFF_CAP} bytes; use pr_file_diff(path) for specific files]`;
      return text(out || "No textual changes.");
    },
  };

  const fileDiff: ToolDefinition = {
    name: "pr_file_diff",
    label: "PR file diff",
    description:
      "Get the unified diff (patch) for a single changed file. Use the exact path from the PR " +
      "overview. Only lines shown here (RIGHT side) are commentable.",
    parameters: Type.Object({
      path: Type.String({ description: "File path exactly as listed in the PR overview." }),
    }),
    execute: async (_id, params: { path: string }): Promise<TextResult> => {
      const all = await files();
      const f = all.find((x) => x.filename === params.path);
      if (!f) return text(`No changed file named "${params.path}". Use a path from the PR overview.`);
      if (!f.patch) return text(`File "${params.path}" (${f.status}) has no textual diff (binary or too large).`);
      return text(f.patch);
    },
  };

  return [prDiff, fileDiff];
}
