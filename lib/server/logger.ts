import fs from "node:fs";
import path from "node:path";
import { logsDir, ensureDir } from "./paths";

// Per session daily log files, matching pr-review-bot.sh: logs/YYYY-MM-DD.log
// with a "[timestamp] message" prefix. Also forwards each line to an optional
// sink so the UI can tail logs over SSE.

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function day(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class SessionLogger {
  constructor(
    private readonly sessionId: string,
    private readonly sink?: (line: string) => void,
  ) {}

  log(message: string): void {
    const line = `[${ts()}] ${message}`;
    const dir = logsDir(this.sessionId);
    ensureDir(dir);
    fs.appendFileSync(path.join(dir, `${day()}.log`), line + "\n");
    this.sink?.(line);
  }

  tail(maxLines = 200): string[] {
    const file = path.join(logsDir(this.sessionId), `${day()}.log`);
    try {
      const raw = fs.readFileSync(file, "utf8");
      return raw.split("\n").filter(Boolean).slice(-maxLines);
    } catch {
      return [];
    }
  }
}
