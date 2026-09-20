// electron-builder afterPack hook.
//
// Copies the assembled Next.js standalone bundle into the app's Resources
// directory. This has to happen here rather than through extraResources because
// electron-builder's file filter unconditionally drops a top-level
// node_modules directory, which the standalone bundle needs. afterPack runs
// before signing, so the copied binaries are signed and notarized too.

const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const resourcesDir = path.join(context.appOutDir, `${appName}.app`, "Contents", "Resources");
  const from = path.join(context.packager.projectDir, ".next", "standalone");
  const to = path.join(resourcesDir, "standalone");

  if (!fs.existsSync(path.join(from, "server.js"))) {
    throw new Error(`afterPack: standalone bundle missing at ${from}. Run the desktop build first.`);
  }

  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
  // Never ship the developer's local state even if a build slipped it in.
  fs.rmSync(path.join(to, "data"), { recursive: true, force: true });

  console.log(`afterPack: copied standalone bundle -> ${to}`);
};
