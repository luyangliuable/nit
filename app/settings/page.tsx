"use client";

import * as React from "react";
import Link from "next/link";
import { FiArrowLeft, FiCheckCircle, FiAlertCircle, FiKey } from "react-icons/fi";
import { SiGithub } from "react-icons/si";
import { toast } from "sonner";
import { useStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthStatus } from "@/lib/shared/types";

const SOURCE_LABELS: Record<AuthStatus["source"], string> = {
  env: "environment variable",
  stored: "in-app token",
  "gh-cli": "gh CLI",
  none: "none",
};

export default function SettingsPage() {
  const { auth } = useStore();
  const [token, setToken] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [hasStoredToken, setHasStoredToken] = React.useState(false);
  const [githubBusy, setGithubBusy] = React.useState(false);
  const [local, setLocal] = React.useState<AuthStatus | null>(null);
  const [endpoint, setEndpoint] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [hasLlmOverride, setHasLlmOverride] = React.useState(false);
  const [llmBusy, setLlmBusy] = React.useState(false);

  const status = local ?? auth;

  React.useEffect(() => {
    void api.authStatus().then((result) => {
      setLocal(result.status);
      setHasStoredToken(result.hasStoredToken);
      setUsername(result.username ?? result.status.login ?? "");
    });
    void api.llmOverride().then((result) => {
      setEndpoint(result.endpoint);
      setHasLlmOverride(result.hasApiKey);
    });
  }, []);

  async function saveGithub() {
    if (!token.trim()) return;
    setGithubBusy(true);
    try {
      const result = await api.saveToken(token.trim(), username.trim());
      setLocal(result.status);
      setHasStoredToken(result.hasStoredToken);
      setUsername(result.username ?? result.status.login ?? "");
      setToken("");
      toast.success(`Signed in as ${result.status.login}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Token rejected");
    } finally {
      setGithubBusy(false);
    }
  }

  async function clearGithub() {
    setGithubBusy(true);
    try {
      const result = await api.clearToken();
      setLocal(result.status);
      setHasStoredToken(result.hasStoredToken);
      setUsername(result.username ?? result.status.login ?? "");
      toast.success("Stored GitHub credentials cleared");
    } finally {
      setGithubBusy(false);
    }
  }

  async function recheckGithub() {
    setGithubBusy(true);
    try {
      const result = await api.authStatus();
      setLocal(result.status);
      setHasStoredToken(result.hasStoredToken);
      setUsername(result.username ?? result.status.login ?? "");
    } finally {
      setGithubBusy(false);
    }
  }

  async function saveLlm() {
    if (!endpoint.trim() || !apiKey.trim()) return;
    setLlmBusy(true);
    try {
      const result = await api.saveLlmOverride(endpoint.trim(), apiKey.trim());
      setEndpoint(result.endpoint);
      setHasLlmOverride(result.hasApiKey);
      setApiKey("");
      toast.success("LLM override saved for new Nit sessions");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "LLM override rejected");
    } finally {
      setLlmBusy(false);
    }
  }

  async function clearLlm() {
    setLlmBusy(true);
    try {
      const result = await api.clearLlmOverride();
      setEndpoint(result.endpoint);
      setHasLlmOverride(result.hasApiKey);
      setApiKey("");
      toast.success("LLM override cleared; Nit will use Pi and environment configuration");
    } finally {
      setLlmBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link href="/" aria-label="Back">
          <Button variant="ghost" size="icon">
            <FiArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Logo className="text-lg" />
        <span className="text-xs text-muted-foreground">Settings</span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <section className="space-y-4 rounded-lg border border-border p-5">
            <div className="flex items-center gap-2">
              <SiGithub className="h-5 w-5" />
              <h2 className="text-sm font-semibold">GitHub authentication</h2>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 p-3 text-sm">
              {status?.ok ? (
                <>
                  <FiCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <div>
                    <div className="font-medium">Signed in as {status.login}</div>
                    <div className="text-xs text-muted-foreground">Using {SOURCE_LABELS[status.source]}.</div>
                  </div>
                </>
              ) : (
                <>
                  <FiAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <div className="font-medium">Not authenticated</div>
                    <div className="text-xs text-muted-foreground">{status?.error ?? "Reviewing is disabled until you sign in."}</div>
                  </div>
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="github-username">GitHub username</Label>
                <Input
                  id="github-username"
                  placeholder="octocat"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pat">Personal access token</Label>
                <Input
                  id="pat"
                  type="password"
                  placeholder={hasStoredToken ? "A token is stored. Enter a new one to replace it." : "ghp_..."}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => void saveGithub()} disabled={githubBusy || !token.trim()}>
                Save GitHub credentials
              </Button>
              <Button variant="outline" size="sm" onClick={() => void recheckGithub()} disabled={githubBusy}>
                Check again
              </Button>
              {hasStoredToken && (
                <Button variant="ghost" size="sm" onClick={() => void clearGithub()} disabled={githubBusy}>
                  Clear override
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The token needs <code>repo</code> scope (and <code>read:org</code> for org repos). Nit uses this
              override for polling, reading diffs, and posting reviews before falling back to <code>GH_TOKEN</code> or
              <code>gh auth login</code>.
            </p>
          </section>

          <section className="space-y-4 rounded-lg border border-border p-5">
            <div className="flex items-center gap-2">
              <FiKey className="h-5 w-5" />
              <h2 className="text-sm font-semibold">LLM connection</h2>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 p-3 text-sm">
              {hasLlmOverride ? (
                <>
                  <FiCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <div>
                    <div className="font-medium">In-app LLM override configured</div>
                    <div className="text-xs text-muted-foreground">New Nit sessions use this endpoint instead of environment credentials.</div>
                  </div>
                </>
              ) : (
                <>
                  <FiKey className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Using Pi and environment configuration</div>
                    <div className="text-xs text-muted-foreground">Save an endpoint and key to override it for Nit.</div>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-endpoint">OpenAI-compatible endpoint</Label>
              <Input
                id="llm-endpoint"
                type="url"
                placeholder="https://api.example.com/v1"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                autoComplete="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-key">API key</Label>
              <Input
                id="llm-key"
                type="password"
                placeholder={hasLlmOverride ? "A key is stored. Enter a new one to replace it." : "sk-..."}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => void saveLlm()} disabled={llmBusy || !endpoint.trim() || !apiKey.trim()}>
                Save LLM override
              </Button>
              {hasLlmOverride && (
                <Button variant="ghost" size="sm" onClick={() => void clearLlm()} disabled={llmBusy}>
                  Clear override
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Nit stores this key locally in its data directory, matching the existing token-storage behavior. The key
              is never returned to the browser after saving and is used only for Nit model requests.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
