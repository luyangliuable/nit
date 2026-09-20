// Assemble the standalone server bundle that Electron ships as an
// extraResource. Next's standalone output does not include .next/static or
// public, so copy them in; then make sure no developer state leaked in.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static");
const publicDir = path.join(root, "public");

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("prepare-standalone: .next/standalone/server.js not found. Run `next build` first.");
  process.exit(1);
}

function copy(from, to) {
  if (!fs.existsSync(from)) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`prepare-standalone: copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

copy(staticDir, path.join(standalone, ".next", "static"));
copy(publicDir, path.join(standalone, "public"));

// Defensive: never ship the developer's sessions, clones, or logs.
fs.rmSync(path.join(standalone, "data"), { recursive: true, force: true });

console.log("prepare-standalone: ready");
