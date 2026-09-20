import type { SessionConfig, ChatStreamEvent } from "@/lib/shared/types";
import { resolveModel, getAuth, getRegistry } from "./pi";
import { loadPiSdk } from "./pi-sdk";
import { createPiEventMapper } from "./pi-stream";
import { hub } from "./events";
import { ensureWorkspaceRoot } from "./paths";

// Implement mode interactive session. Wraps a pi AgentSession with coding tools
// (read, bash, edit, write), persisted as a native pi JSONL session so history
// survives restarts and is openable by the pi CLI. Streams events to the UI
// over SSE and supports pi slash commands via prompt template expansion.
export class ChatSession {
  private session: any = null;
  private unsubscribe: (() => void) | null = null;
  private slashCommands: { name: string; description: string }[] = [];
  private cwd: string;
  // Shared mapper from raw pi events to ChatStreamEvents.
  private mapEvent = createPiEventMapper();

  constructor(private config: SessionConfig) {
    this.cwd = config.localPath && config.localPath.trim() !== "" ? config.localPath : ensureWorkspaceRoot();
  }

  private emit(event: ChatStreamEvent): void {
    hub.publish({ type: "chat", sessionId: this.config.id, event });
  }

  async ensure(): Promise<void> {
    if (this.session) return;
    const sdk = await loadPiSdk();

    const loader = new sdk.DefaultResourceLoader({ cwd: this.cwd, agentDir: sdk.getAgentDir() });
    await loader.reload();
    this.slashCommands = loader
      .getPrompts()
      .prompts.map((p: { name: string; description?: string }) => ({
        name: p.name,
        description: p.description ?? "",
      }));

    const selection = this.config.implementModel ?? this.config.model;
    const { session } = await sdk.createAgentSession({
      cwd: this.cwd,
      model: await resolveModel(selection),
      thinkingLevel: selection.thinking,
      resourceLoader: loader,
      sessionManager: sdk.SessionManager.create(this.cwd),
      authStorage: await getAuth(),
      modelRegistry: await getRegistry(),
    });
    this.session = session;

    this.unsubscribe = session.subscribe((event: unknown) => {
      const mapped = this.mapEvent(event);
      if (mapped) this.emit(mapped);
    });
  }

  getSlashCommands(): { name: string; description: string }[] {
    return this.slashCommands;
  }

  async prompt(text: string): Promise<void> {
    await this.ensure();
    if (!this.session) return;
    try {
      if (this.session.isStreaming) {
        await this.session.prompt(text, { expandPromptTemplates: true, streamingBehavior: "followUp" });
      } else {
        await this.session.prompt(text, { expandPromptTemplates: true });
      }
    } catch (err) {
      this.emit({ type: "error", message: String(err) });
    }
  }

  async abort(): Promise<void> {
    if (this.session) await this.session.abort();
  }

  // Serialize current history for initial UI render.
  history(): { role: string; text: string }[] {
    if (!this.session) return [];
    const out: { role: string; text: string }[] = [];
    for (const m of this.session.messages as { role: string; content: unknown }[]) {
      let text = "";
      if (typeof m.content === "string") {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = (m.content as { type: string; text?: string }[])
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("");
      }
      if (text) out.push({ role: m.role, text });
    }
    return out;
  }

  async dispose(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe();
    if (this.session) this.session.dispose();
    this.session = null;
  }
}
