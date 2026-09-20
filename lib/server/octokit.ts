import type { Octokit as OctokitType } from "octokit";
import type { AuthStatus } from "@/lib/shared/types";
import { exec } from "./exec";
import { credentials } from "./credentials";

// Authenticated GitHub node SDK client. Token resolution order:
//   1. GH_TOKEN / GITHUB_TOKEN environment variables
//   2. a token stored via the credential store (Settings page)
//   3. the ambient gh CLI token (`gh auth token`)
// so Nit works out of the box for gh users but can also be configured in-app.
//
// octokit ships ESM only; load it through a native dynamic import so neither
// tsx (CJS) nor Next's server bundler rewrites it to a failing require(), the
// same approach as pi-sdk.ts.
const nativeImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

let client: Promise<OctokitType> | null = null;
let statusCache: { at: number; status: AuthStatus } | null = null;

interface ResolvedToken {
  token: string;
  source: AuthStatus["source"];
}

async function resolveToken(): Promise<ResolvedToken | null> {
  const stored = await credentials.getGithubToken();
  if (stored) return { token: stored, source: "stored" };
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv && fromEnv.trim()) return { token: fromEnv.trim(), source: "env" };
  const r = await exec("gh", ["auth", "token"]);
  if (r.code === 0 && r.stdout.trim()) return { token: r.stdout.trim(), source: "gh-cli" };
  return null;
}

export function getOctokit(): Promise<OctokitType> {
  if (!client) {
    client = (async () => {
      const resolved = await resolveToken();
      if (!resolved) throw new Error("No GitHub token: sign in on the Settings page or run `gh auth login`.");
      const { Octokit } = await nativeImport("octokit");
      return new Octokit({ auth: resolved.token }) as OctokitType;
    })();
  }
  return client;
}

// Drop the cached client and status so the next call picks up a new token.
export function resetOctokit(): void {
  client = null;
  statusCache = null;
}

// Whether GitHub auth currently works, and as whom. Cached briefly so repeated
// UI polls and review gate checks do not hammer the API.
export async function githubAuthStatus(force = false): Promise<AuthStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 15000) return statusCache.status;
  let status: AuthStatus;
  const resolved = await resolveToken();
  if (!resolved) {
    status = { ok: false, source: "none", error: "Not authenticated. Sign in on the Settings page or run `gh auth login`." };
  } else {
    try {
      const o = await getOctokit();
      const me = await o.rest.users.getAuthenticated();
      status = { ok: true, source: resolved.source, login: me.data.login };
    } catch (err) {
      status = { ok: false, source: resolved.source, error: `GitHub rejected the token: ${String((err as Error).message ?? err)}` };
    }
  }
  statusCache = { at: Date.now(), status };
  return status;
}
