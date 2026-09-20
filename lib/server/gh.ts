import { credentials } from "./credentials";
import { exec, type ExecResult } from "./exec";

// GitHub CLI wrappers. Everything the poller and posting flow needs. Stored
// Settings credentials override the ambient gh CLI and environment credentials.

export interface PrListItem {
  number: number;
  title: string;
  body: string;
  headRefOid: string;
  isDraft: boolean;
  mergedAt: string | null;
  author: { login: string };
  createdAt: string;
  reviewRequests?: { login?: string; name?: string; slug?: string }[];
}

const PR_FIELDS =
  "number,title,body,headRefOid,isDraft,mergedAt,author,createdAt,reviewRequests";

/** Execute gh with Nit’s stored token when one is configured. */
async function gh(args: string[], options?: { input?: string }): Promise<ExecResult> {
  const token = await credentials.getGithubToken();
  return exec("gh", args, {
    ...options,
    env: token ? { GH_TOKEN: token } : undefined,
  });
}

export async function ghAuthOk(): Promise<boolean> {
  const r = await gh(["auth", "status"]);
  return r.code === 0;
}

export async function currentLogin(): Promise<string> {
  const configured = await credentials.getGithubUsername();
  if (configured) return configured;
  const r = await gh(["api", "user", "--jq", ".login"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

export async function repoAccessible(repo: string): Promise<boolean> {
  const r = await gh(["repo", "view", repo]);
  return r.code === 0;
}

export async function canonicalRepo(repo: string): Promise<string | null> {
  const r = await gh([
    "repo",
    "view",
    repo,
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

export async function listOpenPrs(repo: string): Promise<PrListItem[]> {
  const r = await gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    PR_FIELDS,
  ]);
  if (r.code !== 0) throw new Error(`pr list failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout || "[]");
}

export async function listOpenPrsByAuthor(
  repo: string,
  author: string,
): Promise<PrListItem[]> {
  const r = await gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--author",
    author,
    "--limit",
    "100",
    "--json",
    PR_FIELDS,
  ]);
  if (r.code !== 0) throw new Error(`pr list failed: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout || "[]");
}

export async function viewPr(
  repo: string,
  pr: string,
): Promise<PrListItem | null> {
  const r = await gh([
    "pr",
    "view",
    pr,
    "--repo",
    repo,
    "--json",
    PR_FIELDS,
  ]);
  if (r.code !== 0) return null;
  return JSON.parse(r.stdout);
}

export async function prDiff(repo: string, pr: number): Promise<string | null> {
  const r = await gh(["pr", "diff", String(pr), "--repo", repo]);
  if (r.code !== 0) return null;
  return r.stdout;
}

export async function headCommitDate(
  repo: string,
  sha: string,
): Promise<string | null> {
  const r = await gh([
    "api",
    `repos/${repo}/commits/${sha}`,
    "--jq",
    ".commit.committer.date",
  ]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

export interface ReviewThread {
  isResolved: boolean;
  firstAuthor: string;
}

export async function reviewThreads(
  repo: string,
  pr: number,
): Promise<ReviewThread[]> {
  const owner = repo.split("/")[0];
  const name = repo.split("/")[1];
  const query = `query($owner:String!,$name:String!,$pr:Int!){
    repository(owner:$owner,name:$name){
      pullRequest(number:$pr){
        reviewThreads(first:100){ nodes{ isResolved comments(first:1){ nodes{ author{ login } } } } }
      } } }`;
  const r = await gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `pr=${pr}`,
  ]);
  if (r.code !== 0) throw new Error(`review threads failed: ${r.stderr.trim()}`);
  const json = JSON.parse(r.stdout);
  const nodes = json?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return nodes.map((n: { isResolved: boolean; comments: { nodes: { author?: { login?: string } }[] } }) => ({
    isResolved: n.isResolved,
    firstAuthor: n.comments?.nodes?.[0]?.author?.login ?? "",
  }));
}

export async function postApprove(
  repo: string,
  pr: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await gh([
    "pr",
    "review",
    String(pr),
    "--repo",
    repo,
    "--approve",
    "--body",
    body || "lgtm",
  ]);
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export interface InlineComment {
  path: string;
  line: number;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
  body: string;
}

export async function postSuggestions(
  repo: string,
  pr: number,
  sha: string,
  comments: InlineComment[],
): Promise<{ ok: boolean; threadIds: number[]; error?: string }> {
  const target = (await canonicalRepo(repo)) ?? repo;
  const payload = JSON.stringify({
    commit_id: sha,
    event: "COMMENT",
    comments,
  });
  const r = await gh(
    ["api", `repos/${target}/pulls/${pr}/reviews`, "-X", "POST", "--input", "-"],
    { input: payload },
  );
  if (r.code !== 0 || !r.stdout.trim()) {
    return { ok: false, threadIds: [], error: r.stderr.trim() };
  }
  let reviewId = "";
  try {
    reviewId = String(JSON.parse(r.stdout).id ?? "");
  } catch {
    reviewId = "";
  }
  let threadIds: number[] = [];
  if (reviewId) {
    const c = await gh([
      "api",
      `repos/${target}/pulls/${pr}/reviews/${reviewId}/comments`,
      "--jq",
      "[.[].id]",
    ]);
    if (c.code === 0) {
      try {
        threadIds = JSON.parse(c.stdout);
      } catch {
        threadIds = [];
      }
    }
  }
  return { ok: true, threadIds };
}
