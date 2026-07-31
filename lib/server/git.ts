import { exec } from "./exec";

// Git helpers for Implement mode. All operate inside a local checkout (cwd).

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function currentBranch(cwd: string): Promise<string> {
  const r = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return r.code === 0 ? r.stdout.trim() : "";
}

export async function listBranches(cwd: string): Promise<string[]> {
  const r = await exec("git", ["branch", "--format=%(refname:short)"], { cwd });
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface StatusEntry {
  status: string; // two char porcelain code
  path: string;
}

export async function status(cwd: string): Promise<StatusEntry[]> {
  const r = await exec("git", ["status", "--porcelain=v1"], { cwd });
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((l) => l.length > 3)
    .map((l) => ({ status: l.slice(0, 2), path: l.slice(3) }));
}

// Unified diff. When staged is true, shows the staged (index) diff.
export async function diff(cwd: string, staged: boolean): Promise<string> {
  const args = ["diff"];
  if (staged) args.push("--staged");
  const r = await exec("git", args, { cwd });
  return r.code === 0 ? r.stdout : "";
}

export async function checkout(
  cwd: string,
  branch: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await exec("git", ["checkout", branch], { cwd });
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export async function createBranch(
  cwd: string,
  branch: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await exec("git", ["checkout", "-b", branch], { cwd });
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export async function stageAll(cwd: string): Promise<{ ok: boolean; error?: string }> {
  const r = await exec("git", ["add", "-A"], { cwd });
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export async function commit(
  cwd: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await exec("git", ["commit", "-m", message], { cwd });
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

export async function push(cwd: string): Promise<{ ok: boolean; error?: string }> {
  const branch = await currentBranch(cwd);
  const r = await exec("git", ["push", "-u", "origin", branch], { cwd });
  return r.code === 0 ? { ok: true } : { ok: false, error: r.stderr.trim() };
}

// Open a PR for the current branch via gh. Returns the created PR url.
export async function openPr(
  cwd: string,
  title: string,
  body: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await exec(
    "gh",
    ["pr", "create", "--fill", "--title", title, "--body", body],
    { cwd },
  );
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() };
  return { ok: true, url: r.stdout.trim() };
}
