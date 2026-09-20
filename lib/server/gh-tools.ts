import { Type } from "typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ReviewComment, ReviewVerdict } from "@/lib/shared/types";
import { getOctokit } from "./octokit";
import { validateSuggestion, canSubmit, type SuggestionInput, type Validation } from "@/lib/core/review-coverage";

// Tool-driven PR review context. Diffs are delivered per file through tracked
// tools so we can require every file to be reviewed; suggestions are captured
// incrementally (so nothing is forgotten) and validated against the diff on the
// spot; submit_review is gated on full coverage and produces the verdict.

type TextResult = { content: { type: "text"; text: string }[]; details: unknown; terminate?: boolean };
const text = (body: string, terminate?: boolean): TextResult => ({ content: [{ type: "text", text: body }], details: {}, terminate });

interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  previous_filename?: string;
}

const PER_FILE_CAP = 40000;

// Sort so the agent's default view is source-first: real source files before
// tests, then generated/lock/vendored noise last. Order within a group keeps
// GitHub's ordering. The agent is free to review in any order regardless.
function noiseRank(path: string): number {
  const bn = path.replace(/.*\//, "");
  if (/(^|\/)(\.venv|node_modules|vendor|dist|build)\//.test(path)) return 3;
  if (/(lock|\.lock|-lock\.json|\.min\.|\.snap|\.map)$/.test(bn) || /\.(lock)$/.test(bn)) return 3;
  if (/(^|\/)(tests?|__tests__|spec)\//.test(path) || /\.(test|spec)\./.test(bn)) return 1;
  return 0;
}
function sortFiles(files: PrFile[]): PrFile[] {
  return files.map((f, i) => ({ f, i })).sort((a, b) => noiseRank(a.f.filename) - noiseRank(b.f.filename) || a.i - b.i).map((x) => x.f);
}

function patchText(f: PrFile): string {
  if (!f.patch) return `(no textual diff for ${f.filename}: binary or too large; read the file in the checkout if needed)`;
  if (f.patch.length > PER_FILE_CAP) return f.patch.slice(0, PER_FILE_CAP) + `\n[diff truncated; read ${f.filename} in the checkout for the rest]`;
  return f.patch;
}

function stripDiffPath(path: string): string {
  return path.replace(/^[ab]\//, "");
}

function parseChangedFiles(diff: string): PrFile[] {
  const files: (PrFile & { lines: string[] })[] = [];
  let cur: (PrFile & { lines: string[] }) | null = null;
  const flush = () => {
    if (!cur) return;
    cur.patch = cur.lines.join("\n");
    files.push(cur);
    cur = null;
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      const parts = line.split(/\s+/);
      cur = { filename: stripDiffPath(parts[3] ?? ""), status: "modified", additions: 0, deletions: 0, lines: [line] };
      const oldPath = stripDiffPath(parts[2] ?? "");
      if (oldPath && oldPath !== cur.filename) cur.previous_filename = oldPath;
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (line.startsWith("new file mode ")) cur.status = "added";
    else if (line.startsWith("deleted file mode ")) cur.status = "removed";
    else if (line.startsWith("rename from ")) {
      cur.status = "renamed";
      cur.previous_filename = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      cur.status = "renamed";
      cur.filename = line.slice("rename to ".length);
    }
    if (line.startsWith("+++ ")) {
      const p = stripDiffPath(line.slice(4).split(/\s+/)[0] ?? "");
      if (p !== "/dev/null") cur.filename = p;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) cur.additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) cur.deletions++;
  }

  flush();
  return sortFiles(files.map(({ lines: _lines, ...file }) => file));
}

export interface PrReviewContext {
  tools: ToolDefinition[];
  manifest(): Promise<string>;
  remaining(): Promise<string[]>;
  getVerdict(): ReviewVerdict | null;
  // Resolves as soon as a verdict is submitted, so the caller can end the pi
  // run promptly instead of waiting for the model to stop on its own.
  completed: Promise<void>;
  // Files (absolute paths) the agent MUST read before submit_review is allowed.
  // Set once the resource loader reports which skills/docs were loaded.
  setRequiredReads(paths: string[]): void;
  // Record that the agent read a file (absolute path), toward the gate.
  markRead(path: string): void;
  // Required files not yet read, for reminders and the submit gate.
  unreadRequired(): string[];
}

export function createPrReviewContext(
  repo: string,
  pr: number,
  reviewDiff: string,
  validate: (s: SuggestionInput) => Validation,
): PrReviewContext {
  const [owner, name] = repo.split("/");
  let filesCache: Promise<PrFile[]> | null = null;
  const files = () =>
    (filesCache ??= reviewDiff.trim()
      ? Promise.resolve(parseChangedFiles(reviewDiff))
      : getOctokit()
        .then((o) => o.paginate(o.rest.pulls.listFiles, { owner, repo: name, pull_number: pr, per_page: 100 }))
        .then((fs) => sortFiles(fs as PrFile[])));
  const visited = new Set<string>();
  const suggestions: ReviewComment[] = [];
  // Absolute paths that must be read before submitting, and those read so far.
  const requiredReads = new Set<string>();
  const readFiles = new Set<string>();
  const unreadRequired = (): string[] => [...requiredReads].filter((p) => !readFiles.has(p));
  let verdict: ReviewVerdict | null = null;
  let markComplete!: () => void;
  const completed = new Promise<void>((resolve) => (markComplete = resolve));

  async function manifest(): Promise<string> {
    const all = await files();
    return `Changed files (${all.length}):\n${all
      .map((f, i) => `${i + 1}. ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})${f.previous_filename ? ` [from ${f.previous_filename}]` : ""}`)
      .join("\n")}`;
  }
  async function remaining(): Promise<string[]> {
    return (await files()).map((f) => f.filename).filter((p) => !visited.has(p));
  }
  function unreadRequiredMessage(): string | null {
    const unread = unreadRequired();
    if (unread.length === 0) return null;
    return `Required context must be read before PR diffs are available. Use the read tool on: ${unread.join(", ")}`;
  }
  function body(f: PrFile, all: PrFile[]): string {
    visited.add(f.filename);
    const left = all.length - visited.size;
    return `File ${all.indexOf(f) + 1}/${all.length}: ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n\n${patchText(f)}\n\nYou can add_suggestion for issues in this file now, or later before submit_review.\n\n[${left} file(s) not yet reviewed.${left > 0 ? " Call next_pr_file() again." : " Add any remaining suggestions, then submit_review()."}]`;
  }

  const status: ToolDefinition = {
    name: "review_status",
    label: "Review status",
    description: "List which changed files you have and have not reviewed yet, so you can plan your order and confirm coverage before submit_review.",
    parameters: Type.Object({}),
    execute: async (): Promise<TextResult> => {
      const all = await files();
      const done = all.filter((f) => visited.has(f.filename)).map((f) => f.filename);
      const left = all.filter((f) => !visited.has(f.filename)).map((f) => f.filename);
      const unread = unreadRequired();
      const context = unread.length > 0 ? `Required context unread (${unread.length}):\n${unread.map((p) => `- ${p}`).join("\n")}\n\n` : "";
      return text(`${context}Reviewed ${done.length}/${all.length}.\nRemaining (${left.length}):\n${left.map((p) => `- ${p}`).join("\n") || "(none)"}`);
    },
  };

  const nextFile: ToolDefinition = {
    name: "next_pr_file",
    label: "Next PR file",
    description: "Convenience: return the diff of an arbitrary changed file you have not reviewed yet. Prefer pr_file_diff(path) to choose the order yourself; use this only to mop up remaining files.",
    parameters: Type.Object({}),
    execute: async (): Promise<TextResult> => {
      const blocked = unreadRequiredMessage();
      if (blocked) return text(blocked);
      const all = await files();
      const next = all.find((f) => !visited.has(f.filename));
      if (!next) return text(`All ${all.length} files reviewed. Add any final suggestions, then call submit_review().`);
      return text(body(next, all));
    },
  };

  const fileDiff: ToolDefinition = {
    name: "pr_file_diff",
    label: "PR file diff",
    description: "Get the unified diff for a specific changed file you choose (exact path from the changed-files list). This is the primary way to review: pick files in whatever order is most effective. Marks it reviewed.",
    parameters: Type.Object({ path: Type.String({ description: "Exact changed-file path." }) }),
    execute: async (_id, p: { path: string }): Promise<TextResult> => {
      const blocked = unreadRequiredMessage();
      if (blocked) return text(blocked);
      const all = await files();
      const f = all.find((x) => x.filename === p.path);
      if (!f) return text(`No changed file named "${p.path}". Use a path from the changed-files list.`);
      return text(body(f, all));
    },
  };

  const addSuggestion: ToolDefinition = {
    name: "add_suggestion",
    label: "Add suggestion",
    description: "Record an inline review suggestion as soon as you spot it. line/startLine are RIGHT-side (new file) line numbers from the diff. Prefer a GitHub commit suggestion by including a ```suggestion fenced replacement in body when there is a safe exact fix. Returns whether it was accepted.",
    parameters: Type.Object({
      path: Type.String(),
      line: Type.Number({ description: "Last (or only) RIGHT-side line the note anchors to." }),
      startLine: Type.Optional(Type.Number({ description: "First RIGHT-side line for a multi-line region." })),
      body: Type.String({ description: "1-3 friendly, peer-toned sentences." }),
    }),
    execute: async (_id, s: SuggestionInput): Promise<TextResult> => {
      const v = validate(s);
      if (!v.ok) return text(`rejected: ${v.reason}. Fix the line/path and try again.`);
      suggestions.push({ path: s.path, line: s.line, side: "RIGHT", ...(v.startLine !== undefined ? { startLine: v.startLine } : {}), body: s.body });
      return text(`accepted (${suggestions.length} suggestion(s) so far).`);
    },
  };

  const submit: ToolDefinition = {
    name: "submit_review",
    label: "Submit review",
    description: 'Finish the review. decision is "approve" (no issues) or "suggestions". Only succeeds once every file has been reviewed.',
    parameters: Type.Object({
      decision: Type.Union([Type.Literal("approve"), Type.Literal("suggestions")]),
      summary: Type.String({ description: '1-2 sentences. For approve, start with "lgtm".' }),
    }),
    execute: async (_id, v: { decision: "approve" | "suggestions"; summary: string }): Promise<TextResult> => {
      const check = canSubmit({ remaining: await remaining(), decision: v.decision, suggestionCount: suggestions.length, unreadRequired: unreadRequired() });
      if (!check.ok) return text(`cannot submit: ${check.reason}`);
      verdict = { decision: v.decision, summary: v.summary, comments: suggestions };
      markComplete();
      return text(`Review submitted: ${v.decision} with ${suggestions.length} suggestion(s).`, true);
    },
  };

  return {
    tools: [fileDiff, status, nextFile, addSuggestion, submit],
    manifest,
    remaining,
    getVerdict: () => verdict,
    completed,
    setRequiredReads: (paths: string[]) => {
      requiredReads.clear();
      for (const p of paths) requiredReads.add(p);
    },
    markRead: (p: string) => readFiles.add(p),
    unreadRequired,
  };
}

// Front-loadable high level overview (metadata, commits, prior reviews/comments).
export async function fetchPrOverview(repo: string, pr: number): Promise<string> {
  const [owner, name] = repo.split("/");
  const o = await getOctokit();
  const [pull, commits, reviews, comments] = await Promise.all([
    o.rest.pulls.get({ owner, repo: name, pull_number: pr }),
    o.paginate(o.rest.pulls.listCommits, { owner, repo: name, pull_number: pr, per_page: 100 }),
    o.paginate(o.rest.pulls.listReviews, { owner, repo: name, pull_number: pr, per_page: 100 }),
    o.paginate(o.rest.pulls.listReviewComments, { owner, repo: name, pull_number: pr, per_page: 100 }),
  ]);
  return JSON.stringify(
    {
      title: pull.data.title,
      description: pull.data.body ?? "",
      author: pull.data.user?.login ?? "",
      state: pull.data.state,
      draft: pull.data.draft ?? false,
      base: pull.data.base.ref,
      head: pull.data.head.ref,
      headSha: pull.data.head.sha,
      commits: commits.map((c) => ({ sha: c.sha.slice(0, 12), message: c.commit.message.split("\n")[0], author: c.commit.author?.name ?? c.author?.login ?? "", date: c.commit.author?.date ?? "" })),
      reviews: reviews.map((r) => ({ author: r.user?.login ?? "", state: r.state, body: r.body ?? "", submittedAt: r.submitted_at ?? "" })),
      reviewComments: comments.map((c) => ({ path: c.path, line: c.line ?? c.original_line ?? null, author: c.user?.login ?? "", body: c.body })),
    },
    null,
    2,
  );
}
