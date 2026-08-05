"use client";

import * as React from "react";
import Link from "next/link";
import { FiArrowLeft, FiCheckCircle, FiAlertCircle } from "react-icons/fi";
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
  const [hasStoredToken, setHasStoredToken] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [local, setLocal] = React.useState<AuthStatus | null>(null);

  const status = local ?? auth;

  React.useEffect(() => {
    void api.authStatus().then((r) => {
      setLocal(r.status);
      setHasStoredToken(r.hasStoredToken);
    });
  }, []);

  async function save() {
    if (!token.trim()) return;
    setBusy(true);
    const r = await api.saveToken(token.trim());
    setBusy(false);
    if (r.status.ok) {
      setLocal(r.status);
      setHasStoredToken(r.hasStoredToken);
      setToken("");
      toast.success(`Signed in as ${r.status.login}`);
    } else {
      toast.error(r.status.error ?? "Token rejected");
    }
  }

  async function clear() {
    setBusy(true);
    const r = await api.clearToken();
    setBusy(false);
    setLocal(r.status);
    setHasStoredToken(r.hasStoredToken);
    toast.success("Stored token cleared");
  }

  async function recheck() {
    setBusy(true);
    const r = await api.authStatus();
    setBusy(false);
    setLocal(r.status);
    setHasStoredToken(r.hasStoredToken);
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

            <div className="space-y-1.5">
              <Label htmlFor="pat">Personal access token</Label>
              <div className="flex gap-2">
                <Input
                  id="pat"
                  type="password"
                  placeholder={hasStoredToken ? "A token is stored. Enter a new one to replace it." : "ghp_..."}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
                <Button onClick={() => void save()} disabled={busy || !token.trim()}>
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Needs the <code>repo</code> scope (and <code>read:org</code> for org repos). Stored locally on this
                machine and never sent anywhere except GitHub.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void recheck()} disabled={busy}>
                Check again
              </Button>
              {hasStoredToken && (
                <Button variant="ghost" size="sm" onClick={() => void clear()} disabled={busy}>
                  Clear stored token
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Alternatively, run <code>gh auth login</code> in your terminal, or set the <code>GH_TOKEN</code>{" "}
              environment variable. Nit reuses whichever is available.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
