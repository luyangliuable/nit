import type { SessionConfig, SessionSnapshot } from "@/lib/shared/types";

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
};
