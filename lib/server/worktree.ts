import fs from "node:fs";
import { exec } from "./exec";
import { repoCloneDir, repoWorktreeDir, ensureDir, DATA_DIR, ensureWorkspaceRoot } from "./paths";

// Manages one shared git clone per repo plus a per-PR worktree checked out at
// the PR head. Worktrees share the shared clone's object store, so we never
// re-clone or duplicate objects. Git operations on a given clone are serialized
// with a per-repo lock because concurrent fetch / worktree ops on the same repo
// dir conflict.

const locks = new Map<string, Promise<unknown>>();

// Run `fn` exclusively per repo, chaining onto any in-flight op for that repo.
function withRepoLock<T>(repo: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(repo) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    repo,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  // Use gh as the git credential helper so private repos work with ambient auth
  // and no token ends up in remotes or logs.
  return exec("git", ["-c", "credential.helper=!gh auth git-credential", ...args], { cwd, timeoutMs: 180000 });
}

async function isCloneReady(dir: string): Promise<boolean> {
  if (!fs.existsSync(dir)) return false;
  const r = await git(dir, ["rev-parse", "--git-dir"]);
  return r.code === 0;
}

// Ensure the shared clone exists (clone once), reusing it on every later call.
async function ensureClone(repo: string): Promise<string> {
  const dir = repoCloneDir(repo);
  if (await isCloneReady(dir)) return dir;
  ensureDir(DATA_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  const url = `https://github.com/${repo}.git`;
  const r = await git(ensureWorkspaceRoot(), ["clone", url, dir]);
  if (r.code !== 0) throw new Error(`clone failed: ${r.stderr.trim()}`);
  return dir;
}

// Prepare a worktree for a PR at the given head sha and return its path.
// Reuses `hostClone` (the session's local clone path) as the object store when
// it is a valid git repo, so we never clone a repo the user already has; only
// falls back to a managed clone under data/ otherwise. Fetches the PR head
// (works for forks) into FETCH_HEAD without writing refs into the host repo,
// then (re)points a per-PR worktree at the sha, hosted in a nit-managed dir so
// the user's working directory stays clean.
export function prepareWorktree(repo: string, pr: number, headSha: string, hostClone?: string): Promise<string> {
  return withRepoLock(repo, async () => {
    let clone = hostClone && (await isCloneReady(hostClone)) ? hostClone : await ensureClone(repo);
    // Fetch the PR head into the object store. If a provided host clone cannot
    // reach it (e.g. its origin is a different repo), fall back to a managed clone.
    let f = await git(clone, ["fetch", "--no-tags", "origin", `refs/pull/${pr}/head`]);
    if (f.code !== 0 && clone === hostClone) {
      clone = await ensureClone(repo);
      f = await git(clone, ["fetch", "--no-tags", "origin", `refs/pull/${pr}/head`]);
    }
    if (f.code !== 0) throw new Error(`fetch failed: ${f.stderr.trim()}`);

    const wt = repoWorktreeDir(repo, pr);
    if (fs.existsSync(wt)) {
      const cur = await git(wt, ["rev-parse", "HEAD"]);
      if (cur.code === 0 && cur.stdout.trim() === headSha) return wt;
      // Stale checkout: drop it and recreate at the new sha.
      await git(clone, ["worktree", "remove", "--force", wt]);
      fs.rmSync(wt, { recursive: true, force: true });
    }
    ensureDir(repoWorktreeDir(repo, pr).replace(/\/pr-\d+$/, ""));
    await git(clone, ["worktree", "prune"]);
    const add = await git(clone, ["worktree", "add", "--detach", "--force", wt, headSha]);
    if (add.code !== 0) throw new Error(`worktree add failed: ${add.stderr.trim()}`);
    return wt;
  });
}

// Remove a PR worktree's working files (objects stay in the shared clone).
export function removeWorktree(repo: string, pr: number): Promise<void> {
  return withRepoLock(repo, async () => {
    const clone = repoCloneDir(repo);
    const wt = repoWorktreeDir(repo, pr);
    if (fs.existsSync(clone)) await git(clone, ["worktree", "remove", "--force", wt]);
    fs.rmSync(wt, { recursive: true, force: true });
  });
}
