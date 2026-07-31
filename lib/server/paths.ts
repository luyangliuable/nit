import path from "node:path";
import fs from "node:fs";

// All persisted data lives under data/ at the project root, mirroring the
// pr-review-bot layout (state.json plus daily logs) but scoped per session.

export const DATA_DIR = path.join(process.cwd(), "data");
export const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

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
  return path.join(prDir(id, pr), `visualization-${sha.slice(0, 12)}.html`);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
