// Electron main process for the nit desktop app.
//
// The UI and API run in the Next.js standalone server bundle, which this
// process spawns as a child using Electron's own Node runtime
// (ELECTRON_RUN_AS_NODE). The window is a thin view over 127.0.0.1.

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_NAME = "nit";
const DEV_URL = process.env.NIT_ELECTRON_DEV_URL || "";

let serverProcess = null;
let mainWindow = null;
let quitting = false;
let appUrl = "";

function userDataPath(...parts) {
  return path.join(app.getPath("userData"), ...parts);
}

// GUI apps on macOS inherit a minimal PATH. Ask the user's login shell for its
// real PATH so git and the GitHub CLI are found, and keep a few fallbacks.
function resolvePath() {
  const fallbacks = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  let shellPath = "";
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shell, ["-ilc", 'printf "__NIT_PATH__%s__NIT_PATH__" "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    shellPath = (out.match(/__NIT_PATH__(.*?)__NIT_PATH__/s) || [])[1] || "";
  } catch {
    // Ignore; fall through to process PATH and static fallbacks.
  }
  const seen = new Set();
  return [shellPath, process.env.PATH, ...fallbacks]
    .filter(Boolean)
    .join(":")
    .split(":")
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(":");
}

function hasCommand(name, searchPath) {
  return searchPath
    .split(":")
    .some((dir) => dir && fs.existsSync(path.join(dir, name)));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`timed out waiting for ${url}`));
        else setTimeout(attempt, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

// The standalone bundle lives outside the asar: alongside the source tree in
// development, or under resources/standalone in the packaged app.
function serverEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(__dirname, "..", ".next", "standalone", "server.js");
}

function startServer(port, searchPath) {
  const logFile = userDataPath("logs", "server.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: "a" });
  log.write(`\n===== ${new Date().toISOString()} starting ${APP_NAME} server =====\n`);

  serverProcess = spawn(process.execPath, [serverEntry()], {
    cwd: userDataPath(),
    env: {
      ...process.env,
      PATH: searchPath,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NIT_DATA_DIR: userDataPath("data"),
      NIT_WORKSPACE_DIR: userDataPath("workspace"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.pipe(log);
  serverProcess.stderr.pipe(log);
  serverProcess.on("exit", (code) => {
    if (quitting) return;
    dialog.showErrorBox(
      `${APP_NAME} backend stopped`,
      `The local server exited unexpectedly (code ${code}).\n\nLogs: ${logFile}`,
    );
    app.quit();
  });
  return logFile;
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  const child = serverProcess;
  serverProcess = null;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 3000).unref();
}

function openExternal(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#0b0d12",
    show: false,
    // Chrome-style chrome on macOS: hide the title bar and float the traffic
    // lights over the app's own header (which becomes the drag region).
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 18 } : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const { webContents } = mainWindow;
  webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, target) => {
    if (target.startsWith(url)) return;
    event.preventDefault();
    openExternal(target);
  });

  mainWindow.loadURL(url);
}

function buildMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Open data folder", click: () => shell.openPath(userDataPath("data")) },
        { label: "Open logs", click: () => shell.openPath(userDataPath("logs")) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  const searchPath = resolvePath();

  if (DEV_URL) {
    appUrl = DEV_URL;
    buildMenu();
    createWindow(appUrl);
    return;
  }

  if (!fs.existsSync(serverEntry())) {
    dialog.showErrorBox(
      `${APP_NAME} is not built`,
      `Missing standalone server at:\n${serverEntry()}\n\nRun \`npm run desktop:build\` first.`,
    );
    app.quit();
    return;
  }

  if (!hasCommand("gh", searchPath)) {
    dialog.showMessageBox({
      type: "warning",
      message: "GitHub CLI not found",
      detail:
        "nit uses the `gh` CLI for GitHub access. Install it (brew install gh) and run `gh auth login`, then restart nit.",
      buttons: ["Continue"],
    });
  }

  const port = await freePort();
  appUrl = `http://127.0.0.1:${port}`;
  const logFile = startServer(port, searchPath);

  try {
    await waitForServer(`${appUrl}/api/auth`, 60000);
  } catch (err) {
    dialog.showErrorBox(
      `${APP_NAME} failed to start`,
      `${String(err)}\n\nLogs: ${logFile}`,
    );
    stopServer();
    app.quit();
    return;
  }

  buildMenu();
  createWindow(appUrl);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on("activate", () => {
    if (!mainWindow && appUrl) createWindow(appUrl);
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
