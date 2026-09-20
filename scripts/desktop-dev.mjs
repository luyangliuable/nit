// Launch nit in Electron against the tsx dev server. Used by `npm run
// desktop:dev` for iterating on the desktop shell with hot reload.

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || "3000";
const url = `http://127.0.0.1:${port}`;

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`timed out waiting for ${url}`));
        else setTimeout(attempt, 300);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

const dev = spawn("npm", ["run", "dev"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PORT: port },
});

let electron = null;
function shutdown() {
  if (electron) electron.kill("SIGTERM");
  dev.kill("SIGTERM");
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", shutdown);

try {
  await waitForServer(60000);
  electron = spawn(path.join(root, "node_modules", ".bin", "electron"), ["."], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NIT_ELECTRON_DEV_URL: url },
  });
  electron.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
} catch (err) {
  console.error(String(err));
  shutdown();
  process.exit(1);
}
