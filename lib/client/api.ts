import type { SessionConfig, SessionSnapshot, TranscriptBlock, AuthStatus } from "@/lib/shared/types";

export interface AuthResult {
  status: AuthStatus;
  hasStoredToken: boolean;
  username?: string;
}

export interface LlmOverrideStatus {
  endpoint: string;
  hasApiKey: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`API Error ${res.status} (${res.statusText}): ${errorBody}`);
  }
  return (await res.json()) as T;
}

export const api = {
  async listSessions(): Promise<SessionSnapshot[]> {
    const r = await fetch("/api/sessions");
    return (await json<{ sessions: SessionSnapshot[] }>(r)).sessions;
  },
  async createSession(name?: string): Promise<SessionSnapshot> {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return (await json<{ session: SessionSnapshot }>(r)).session;
  },
  async updateSession(id: string, patch: Partial<SessionConfig>): Promise<void> {
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  },
  async deleteSession(id: string): Promise<void> {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  },
  async action(id: string, body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
    const r = await fetch(`/api/sessions/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json(r);
  },
  async visualization(id: string, pr: number, sha: string): Promise<string | null> {
    const r = await fetch(`/api/sessions/${id}/visualization?pr=${pr}&sha=${sha}`);
    if (!r.ok) return null;
    return (await json<{ html: string }>(r)).html;
  },
  async reviewTranscript(id: string, pr: number): Promise<TranscriptBlock[]> {
    const r = await fetch(`/api/sessions/${id}/review-stream?pr=${pr}`);
    if (!r.ok) return [];
    return (await json<{ blocks: TranscriptBlock[] }>(r)).blocks;
  },
  async logs(id: string): Promise<string[]> {
    const r = await fetch(`/api/sessions/${id}/logs`);
    if (!r.ok) return [];
    return (await json<{ lines: string[] }>(r)).lines;
  },
  async chatState(id: string): Promise<{ history: { role: string; text: string }[]; commands: { name: string; description: string }[] }> {
    const r = await fetch(`/api/sessions/${id}/chat`);
    return json(r);
  },
  async chatPrompt(id: string, text: string): Promise<void> {
    await fetch(`/api/sessions/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  },
  async chatAbort(id: string): Promise<void> {
    await fetch(`/api/sessions/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort" }),
    });
  },
  async gitState(id: string): Promise<{ branch?: string; branches?: string[]; status?: { status: string; path: string }[]; error?: string }> {
    const r = await fetch(`/api/sessions/${id}/git`);
    return json(r);
  },
  async gitOp(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await fetch(`/api/sessions/${id}/git`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return json(r);
  },
  async models(): Promise<{ provider: string; id: string }[]> {
    const r = await fetch("/api/models");
    return (await json<{ models: { provider: string; id: string }[] }>(r)).models;
  },
  async authStatus(): Promise<AuthResult> {
    const r = await fetch("/api/auth");
    return json(r);
  },
  async saveToken(token: string, username: string): Promise<AuthResult> {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username }),
    });
    return json(r);
  },
  async clearToken(): Promise<AuthResult> {
    const r = await fetch("/api/auth", { method: "DELETE" });
    return json(r);
  },
  async llmOverride(): Promise<LlmOverrideStatus> {
    const r = await fetch("/api/settings/llm");
    return json(r);
  },
  async saveLlmOverride(endpoint: string, apiKey: string): Promise<LlmOverrideStatus> {
    const r = await fetch("/api/settings/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, apiKey }),
    });
    return json(r);
  },
  async clearLlmOverride(): Promise<LlmOverrideStatus> {
    const r = await fetch("/api/settings/llm", { method: "DELETE" });
    return json(r);
  },
};
