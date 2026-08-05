import { exec } from "./exec";

// GitHub CLI wrappers. Everything the poller and posting flow needs. All calls
// reuse the ambient gh auth, matching pr-review-bot.sh.

export interface PrListItem {
  number: number;
  title: string;
  body: string;
  headRefOid: string;
  isDraft: boolean;
  mergedAt: string | null;
  author: { login: string };
  createdAt: string;
}

const PR_FIELDS =
  "number,title,body,headRefOid,isDraft,mergedAt,author,createdAt";

export async function ghAuthOk(): Promise<boolean> {
  const r = await exec("gh", ["auth", "status"]);
  return r.code === 0;
}

export async function currentLogin(): Promise<string> {
  const r = await exec("gh", ["api", "user", "--jq", ".login"]);
  return r.code === 0 ? r.stdout.trim() : "";
}

export async function repoAccessible(repo: string): Promise<boolean> {
  const r = await exec("gh", ["repo", "view", repo]);
  return r.code === 0;
}

export async function canonicalRepo(repo: string): Promise<string | null> {
  const r = await exec("gh", [
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
  const r = await exec("gh", [
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
  const r = await exec("gh", [
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
  const r = await exec("gh", [
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
  const r = await exec("gh", ["pr", "diff", String(pr), "--repo", repo]);
  if (r.code !== 0) return null;
  return r.stdout;
}

export async function headCommitDate(
  repo: string,
  sha: string,
): Promise<string | null> {
  const r = await exec("gh", [
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

// Fetch the bot review threads with resolution state, for the re-review gate.
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
  const r = await exec("gh", [
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

// Post an approve review. Returns true on success.
export async function postApprove(
  repo: string,
  pr: number,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await exec("gh", [
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
  // Optional multi-line anchor. When present, `start_line` < `line` and both
  // sides are "RIGHT", producing a GitHub multi-line review comment.
  start_line?: number;
  start_side?: "RIGHT";
  body: string;
}

// Post a single body-less COMMENT review grouping inline comments. Returns the
// created review comment ids as thread ids for the re-review gate.
export async function postSuggestions(
  repo: string,
  pr: number,
  sha: string,
  comments: InlineComment[],
): Promise<{ ok: boolean; threadIds: number[]; error?: string }> {
  // gh api does not follow 307 redirects on POST, so a renamed/moved repo (or
  // one addressed with non-canonical casing) fails with "HTTP 307". The GET
  // based wrappers (pr list/diff) hide this because gh follows GET redirects.
  // Resolve the canonical owner/name first so the raw POST hits the real repo.
  const target = (await canonicalRepo(repo)) ?? repo;
  const payload = JSON.stringify({
    commit_id: sha,
    event: "COMMENT",
    comments,
  });
  const r = await exec(
    "gh",
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
    const c = await exec("gh", [
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
