import {
  type SessionConfig,
  type SessionSnapshot,
  defaultSessionConfig,
} from "@/lib/shared/types";
import { normalizeRepo } from "@/lib/core/normalize";
import { Session } from "./session";
import { ChatSession } from "./chat";
import { readJson, writeJson } from "./store";
import { SESSIONS_FILE } from "./paths";
import { hub } from "./events";

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

class SessionManager {
  private sessions = new Map<string, Session>();
  private chats = new Map<string, ChatSession>();
  private loaded = false;

  // Load persisted configs and recreate sessions. Pollers with enabled=true
  // auto resume, matching the "always watching" model.
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const configs = readJson<SessionConfig[]>(SESSIONS_FILE, []);
    for (const config of configs) {
      const session = new Session(config);
      this.sessions.set(config.id, session);
      if (config.enabled && config.mode === "review" && config.repo) {
        session.start();
      }
    }
  }

  private persist(): Promise<void> {
    const configs = [...this.sessions.values()].map((s) => s.config);
    return writeJson(SESSIONS_FILE, configs);
  }

  list(): SessionSnapshot[] {
    return [...this.sessions.values()].map((s) => s.snapshot());
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  create(name?: string): SessionSnapshot {
    const id = randomId();
    const config = defaultSessionConfig(id, name ?? "New workspace");
    const session = new Session(config);
    this.sessions.set(id, session);
    void this.persist();
    const snap = session.snapshot();
    hub.publish({ type: "session_update", session: snap });
    return snap;
  }

  update(id: string, patch: Partial<SessionConfig>): SessionSnapshot | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    const clean = { ...patch };
    if (typeof clean.repo === "string") clean.repo = normalizeRepo(clean.repo);
    session.updateConfig(clean);
    void this.persist();
    return session.snapshot();
  }

  async remove(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      await session.dispose();
      this.sessions.delete(id);
    }
    const chat = this.chats.get(id);
    if (chat) {
      await chat.dispose();
      this.chats.delete(id);
    }
    void this.persist();
    hub.publish({ type: "sessions", sessions: this.list() });
  }

  start(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.updateConfig({ enabled: true });
    session.start();
    void this.persist();
  }

  stop(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.stop();
    session.updateConfig({ enabled: false });
    void this.persist();
  }

  // Lazily create the Implement mode chat session for a tab.
  chat(id: string): ChatSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    let chat = this.chats.get(id);
    if (!chat) {
      chat = new ChatSession(session.config);
      this.chats.set(id, chat);
    }
    return chat;
  }
}

// Persist the manager across Next dev hot reloads.
const globalForManager = globalThis as unknown as { __nitManager?: SessionManager };
export const manager: SessionManager =
  globalForManager.__nitManager ?? new SessionManager();
globalForManager.__nitManager = manager;
manager.load();
