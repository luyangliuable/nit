<p align="center">
  <img src="assets/wordmark.svg" alt="nit" width="240" />
</p>

<h1 align="center">nit</h1>

<p align="center">A PR centric coding agent powered by pi.</p>

<p align="center">
  <a href="https://github.com/luyangliuable/nit/actions/workflows/ci.yaml"><img src="https://github.com/luyangliuable/nit/actions/workflows/ci.yaml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/luyangliuable/nit/actions/workflows/deploy-docs.yaml"><img src="https://github.com/luyangliuable/nit/actions/workflows/deploy-docs.yaml/badge.svg" alt="Docs" /></a>
  <img src="https://img.shields.io/badge/node-20-4a9" alt="Node 20" />
  <img src="https://img.shields.io/badge/powered%20by-pi-c63a3a" alt="Powered by pi" />
</p>

<p align="center">
  <a href="https://luyangliuable.github.io/nit/">Documentation</a>
  <span>&nbsp;.&nbsp;</span>
  <a href="https://luyangliuable.github.io/nit/docs/getting-started">Getting started</a>
  <span>&nbsp;.&nbsp;</span>
  <a href="https://luyangliuable.github.io/nit/docs/review-mode">Review mode</a>
  <span>&nbsp;.&nbsp;</span>
  <a href="https://luyangliuable.github.io/nit/docs/reference">API reference</a>
</p>

---

nit watches a GitHub repository for pull requests, reviews each incoming PR with
a headless pi session, shows you an auto generated HTML visualization of the
changes, and lets you approve or post suggestions with a button. It also runs as
a full pi coding agent so you can implement fixes in a local clone without
leaving the app.

## Features

- Watches a repository and reviews each incoming pull request read only.
- Generates a self contained HTML visualization of every change.
- Holds each verdict in an approval queue. Nothing is posted until you click.
- Edits or drops individual inline suggestions before posting.
- Implement mode: a full pi coding session on a local clone, with a git panel.
- Layered notifications: in app toasts, tab badges, and browser notifications.
- Reuses your pi and gh credentials and stores no secrets of its own.

<p align="center">
  <img src="assets/architecture.svg" alt="nit architecture" width="820" />
</p>

## Quickstart

```bash
npm install
npm run dev
```

Open http://localhost:3000, create a workspace, set a repository, and press
Start. Set `PORT` to change the port and `NIT_CONCURRENCY` to change the cap on
simultaneous review sub sessions.

### Requirements

- Node 20
- The GitHub CLI, authenticated with `gh auth login`
- git
- pi configured with a provider and model under `~/.pi/agent`

## Desktop app

nit also ships as a native macOS app (Apple Silicon). The Electron shell starts
the Next.js standalone server on a loopback port and opens a window over it, so
the desktop build and the browser build run the exact same code.

```bash
npm run desktop:dev     # Electron against the tsx dev server (hot reload)
npm run desktop:build   # next build + assemble the standalone bundle
npm run desktop:pack    # build a signed, notarized DMG (arm64)
npm run desktop:pack:dir  # fast unpacked .app for local testing
```

State lives outside the bundle under the per-user application support
directory (`~/Library/Application Support/nit`), not inside the read-only app.
`NIT_DATA_DIR` and `NIT_WORKSPACE_DIR` override those locations and are what the
Electron shell sets. The Help menu can open the data and log folders.

Because the packaged app is sandboxed from your shell environment, it resolves
your login shell `PATH` at startup so `gh` and `git` are found. If `gh` is
missing it explains how to install it.

### Signing and notarization

`electron-builder.yml` enables the hardened runtime and notarization. Provide a
Developer ID Application certificate and app-specific password through the
standard electron-builder environment variables (`CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`). Without them the build still succeeds but is unsigned.

## What you get

Each tab is a workspace bound to one repository, with a toggle between two modes.

- Review PR mode drives the poller and the approval queue.
- Implement mode drives an interactive pi coding session and the git panel.

## API reference

nit exposes a small REST surface plus one server sent events stream.

| Method | Path | Description |
| --- | --- | --- |
| GET, POST | `/api/sessions` | List or create workspaces |
| GET, PATCH, DELETE | `/api/sessions/:id` | Read, update, or delete a workspace |
| POST | `/api/sessions/:id/action` | Poller control and approval actions |
| GET, POST | `/api/sessions/:id/chat` | Implement mode chat |
| GET, POST | `/api/sessions/:id/git` | Git branch, status, and operations |
| GET | `/api/sessions/:id/visualization` | Saved HTML visualization |
| GET | `/api/models` | Models available in your pi config |
| GET | `/api/events` | Server sent events stream |

See the [API reference](https://luyangliuable.github.io/nit/docs/reference) for
the full action and event list.

## Documentation

Full documentation is at
[luyangliuable.github.io/nit](https://luyangliuable.github.io/nit/).

## Development

```bash
npm test        # unit tests for the ported review logic
npm run lint
npm run typecheck
npm run build
npm run desktop:dev   # run the Electron shell against the dev server
```

## Releases

Every push to `main` runs `.github/workflows/release.yaml`, which builds the
standalone bundle, packages a signed and notarized arm64 DMG, and publishes it
to a rolling GitHub Release tagged `v<version>-build.<run_number>`. Release
notes are generated by GitHub from the pull requests merged since the previous
build, so each DMG ships with a changelog automatically.

The workflow needs these repository secrets:

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | password for that certificate |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple Developer team ID |

The review core is ported from pr-review-bot with unit tests: repo
normalization, diff filtering, RIGHT side line validation, the text sanitizer,
verdict JSON extraction, and the strict re-review gate.

## Architecture

```
nit/
  server.ts              Custom Node server used by the dev workflow
  instrumentation.ts     Boot hook that resumes pollers in the standalone build
  electron/              Electron main process for the desktop app
  scripts/               Desktop build and dev launchers
  app/                   Next.js App Router UI and API routes
    api/                 REST and SSE endpoints
  components/            React UI, review and implement modes
  lib/
    core/                Ported, tested review logic
    server/              SessionManager, poller, pi runner, gh and git
    shared/              Types shared by server and client
  website/               Docusaurus documentation site
  assets/                Branding and diagram SVGs
```

nit is a single long lived Node process. The custom server owns an in memory
SessionManager, the pollers, the embedded pi SDK sessions, and a server sent
events hub. The browser is a thin view over that state. The GitHub CLI and git
run as child processes.

## Examples

<p align="center">
  <img src="assets/examples.svg" alt="Example timeline" width="720" />
</p>

**1. Review and approve.** A PR lands, the poller reviews it, and a verdict
ready notification fires. You open the queued item, read the summary and the
change visualization, edit or drop suggestions, then press Approve or Post
suggestions. nit posts to GitHub only on that click.

**2. Scope the poller.** Set a PR whitelist so nit only reviews the numbers you
care about, using a PATCH to `/api/sessions/:id`.

**3. Fix in Implement mode.** Toggle Implement mode, ask the agent to make the
change, then use the git panel to create a branch, commit, push, and open a PR.
