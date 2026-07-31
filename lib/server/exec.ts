import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Thin promise wrapper over spawn. Never throws on a nonzero exit; the caller
// inspects code. Optionally pipes a string to stdin.
export function exec(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill("SIGKILL");
            resolve({ code: 124, stdout, stderr: stderr + "\n[timed out]" });
          }
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}
