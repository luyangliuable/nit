import path from "node:path";
import fs from "node:fs";

// All persisted data lives under data/ at the project root, mirroring the
// pr-review-bot layout (state.json plus daily logs) but scoped per session.
//
// NIT_DATA_DIR overrides the location. The Electron desktop app points it at
// the per-user application support directory because the packaged bundle is
// read-only and must never be written to.

export const DATA_DIR = process.env.NIT_DATA_DIR?.trim()
  ? path.resolve(process.env.NIT_DATA_DIR)
  : path.join(process.cwd(), "data");

// Working directory used when a workspace has no explicit local clone. Falls
// back to process.cwd() in development, and to a writable user directory in
// the packaged app where process.cwd() is inside the read-only bundle.
export const WORKSPACE_ROOT = process.env.NIT_WORKSPACE_DIR?.trim()
  ? path.resolve(process.env.NIT_WORKSPACE_DIR)
  : process.cwd();
export const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
// App wide (not per session) config, e.g. a stored GitHub token.
export const APP_CONFIG_FILE = path.join(DATA_DIR, "app-config.json");

export function sessionDir(id: string): string {
  return path.join(DATA_DIR, "sessions", id);
}
export function stateFile(id: string): string {
  return path.join(sessionDir(id), "state.json");
}
export function logsDir(id: string): string {
  return path.join(sessionDir(id), "logs");
}
export function agentDir(id: string): string {
  return path.join(sessionDir(id), "agent");
}
export function prDir(id: string, pr: number): string {
  return path.join(sessionDir(id), `pr-${pr}`);
}
export function visualizationFile(id: string, pr: number, sha: string): string {
  return path.join(prDir(id, pr), `visualization-${sha.slice(0, 12)}.json`);
}
// Raw model output saved when verdict parsing fails, for debugging.
export function rawVerdictFile(id: string, pr: number, sha: string): string {
  return path.join(prDir(id, pr), `verdict-raw-${sha.slice(0, 12)}.txt`);
}
// Directory holding the persisted pi review session (JSONL) for a PR, so the
// full transcript (thinking, response, tool calls) survives restarts and is
// openable by the pi CLI.
export function reviewSessionDir(id: string, pr: number): string {
  return path.join(prDir(id, pr), "review-session");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// Best-effort writable workspace root, creating it on first use.
export function ensureWorkspaceRoot(): string {
  ensureDir(WORKSPACE_ROOT);
  return WORKSPACE_ROOT;
}

// Managed git clones, shared across sessions/PRs of the same repo. One clone per
// repo (its object store is reused by all per-PR worktrees to avoid re-cloning).
function repoKey(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9._-]/g, "__");
}
export function repoCloneDir(repo: string): string {
  return path.join(DATA_DIR, "clones", repoKey(repo));
}
// Per-PR worktree checked out at the PR head, hosted on the shared clone.
export function repoWorktreeDir(repo: string, pr: number): string {
  return path.join(DATA_DIR, "clones", `${repoKey(repo)}__worktrees`, `pr-${pr}`);
}
