import type { ModelSelection, ChatStreamEvent, TranscriptBlock } from "@/lib/shared/types";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { loadPiSdk } from "./pi-sdk";
import { createPiEventMapper, messagesToBlocks } from "./pi-stream";

// Read only tool allowlist for review and visualization sub sessions.
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

// Shared auth and model registry. Reuses pi's own auth.json and models.json so
// whatever the user configured for the pi CLI just works, and Nit stores no
// secrets of its own.
let authStorage: any = null;
let modelRegistry: any = null;

export async function getAuth(): Promise<any> {
  if (!authStorage) {
    const sdk = await loadPiSdk();
    authStorage = sdk.AuthStorage.create();
  }
  return authStorage;
}

export async function getRegistry(): Promise<any> {
  if (!modelRegistry) {
    const sdk = await loadPiSdk();
    modelRegistry = sdk.ModelRegistry.create(await getAuth());
  }
  return modelRegistry;
}

// Resolve a ModelSelection to a pi Model. Custom provider models declared in
// models.json are found via the registry.
export async function resolveModel(selection: ModelSelection): Promise<any> {
  const registry = await getRegistry();
  const model = registry.find(selection.provider, selection.model);
  if (!model) {
    throw new Error(
      `Model not found: ${selection.provider}/${selection.model}. Configure it for pi first.`,
    );
  }
  return model;
}

// Cached model list for the UI picker. Building the registry lazily boots the
// whole pi SDK, which is slow on the first call; we compute the list once and
// reuse it so the picker is populated instantly. Warmed at startup via
// preloadModels().
let modelsCache: Promise<{ provider: string; id: string }[]> | null = null;

async function computeModels(): Promise<{ provider: string; id: string }[]> {
  const registry = await getRegistry();
  const models = registry.getAvailable();
  return models.map((m: { provider: string; id: string }) => ({ provider: m.provider, id: m.id }));
}

// List models that have valid credentials, for the UI picker.
export async function listAvailableModels(): Promise<{ provider: string; id: string }[]> {
  if (!modelsCache) {
    // Cache the promise so concurrent callers share one registry build; drop it
    // on failure so a later call can retry.
    modelsCache = computeModels().catch((err) => {
      modelsCache = null;
      throw err;
    });
  }
  try {
    return await modelsCache;
  } catch {
    return [];
  }
}

// Warm the model cache (and the pi registry) ahead of the first client request.
export function preloadModels(): void {
  void listAvailableModels();
}

// Run a single read only prompt in a throwaway in memory session and return the
// full assistant text. Used for both the review verdict and the HTML
// visualization sub sessions.
export async function runReadOnlyPrompt(params: {
  prompt: string;
  cwd: string;
  model: ModelSelection;
  skills: string[];
  signal?: AbortSignal;
  label?: string;
  onLog?: (msg: string) => void;
  onStream?: (event: ChatStreamEvent) => void;
  // When set, the review conversation persists to this dir as a pi JSONL
  // session so the full transcript survives restarts and is CLI openable.
  sessionDir?: string;
  // Extra read only tools (e.g. the granular GitHub PR tools) the agent may
  // call in addition to the built-in read/grep/find/ls tools.
  customTools?: ToolDefinition[];
}): Promise<string> {
  const { prompt, cwd, model, skills, signal, label, onLog, onStream, sessionDir, customTools } = params;
  const sdk = await loadPiSdk();

  // Emit progress to the server console (and optionally a session log) so we
  // can see what each review is doing in real time.
  const tag = label ? ` ${label}` : "";
  const log = (msg: string) => {
    console.log(`[review${tag}] ${msg}`);
    onLog?.(msg);
  };
  const started = Date.now();
  log(`start model=${model.model} thinking=${model.thinking}`);

  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: sdk.getAgentDir(),
    additionalSkillPaths: skills,
  });
  await loader.reload();

  const { session } = await sdk.createAgentSession({
    cwd,
    model: await resolveModel(model),
    thinkingLevel: model.thinking,
    // `tools` is an allowlist: pi filters customTools whose names are not in it,
    // so custom tool names must be included here or the model never sees them.
    tools: [...READ_ONLY_TOOLS, ...(customTools?.map((t) => t.name) ?? [])],
    customTools,
    resourceLoader: loader,
    sessionManager: sessionDir
      ? sdk.SessionManager.create(cwd, sessionDir)
      : sdk.SessionManager.inMemory(),
    authStorage: await getAuth(),
    modelRegistry: await getRegistry(),
  });

  // Wire external cancellation: aborting the signal aborts the pi run so the
  // in-flight review stops promptly.
  if (signal) {
    if (signal.aborted) void session.abort();
    else signal.addEventListener("abort", () => void session.abort(), { once: true });
  }

  let text = "";
  let errorMessage = "";
  let loggedThinking = false;
  let loggedText = false;
  const mapEvent = onStream ? createPiEventMapper() : null;
  const unsubscribe = session.subscribe((event: unknown) => {
    if (mapEvent) {
      const mapped = mapEvent(event);
      if (mapped) onStream?.(mapped);
    }
    const ev = event as {
      type: string;
      assistantMessageEvent?: { type: string; delta?: string; error?: unknown; reason?: string };
      toolName?: string;
      isError?: boolean;
    };
    if (ev.type === "message_update" && ev.assistantMessageEvent) {
      const ame = ev.assistantMessageEvent;
      if (ame.type === "text_delta") {
        text += ame.delta ?? "";
        if (!loggedText) { loggedText = true; log("writing verdict…"); }
      }
      if (ame.type?.startsWith("thinking") && !loggedThinking) {
        loggedThinking = true;
        log("thinking…");
      }
      if (ame.type === "error") {
        errorMessage = typeof ame.error === "string" ? ame.error : JSON.stringify(ame.error);
        log(`error ${errorMessage}`);
      }
    } else if (ev.type === "tool_execution_start") {
      log(`tool ${ev.toolName ?? "?"}`);
    } else if (ev.type === "tool_execution_end") {
      log(`tool ${ev.toolName ?? "?"} done${ev.isError ? " (error)" : ""}`);
    }
  });

  try {
    await session.prompt(prompt, { expandPromptTemplates: false });
  } catch (err) {
    onStream?.({ type: "error", message: String(err) });
    throw err;
  } finally {
    unsubscribe();
    onStream?.({ type: "agent_end" });
    log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${text.length} chars`);
  }

  // Fallback: pull text from the final assistant message if nothing streamed.
  if (text.trim() === "") {
    text = extractText(session.messages);
  }
  if (!errorMessage) {
    errorMessage = (session.agent?.state?.errorMessage as string) ?? "";
  }
  session.dispose();

  if (text.trim() === "" && errorMessage) {
    throw new Error(`pi run error: ${errorMessage}`);
  }
  return text.trim();
}

// Read the most recent persisted review session in a dir and reconstruct its
// transcript blocks (thinking, response, tool calls). Returns [] when nothing
// has been persisted yet. Used to replay history when a PR is (re)selected and
// after server restarts.
export async function readReviewTranscript(sessionDir: string, cwd: string): Promise<TranscriptBlock[]> {
  try {
    const sdk = await loadPiSdk();
    const infos = await sdk.SessionManager.list(cwd, sessionDir);
    if (!infos || infos.length === 0) return [];
    const latest = [...infos].sort(
      (a: { modified: Date }, b: { modified: Date }) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    )[0];
    const mgr = sdk.SessionManager.open(latest.path, sessionDir, cwd);
    const ctx = mgr.buildSessionContext();
    return messagesToBlocks(ctx.messages ?? []);
  } catch {
    return [];
  }
}

// Concatenate assistant text content from message history.
function extractText(messages: any[]): string {
  let out = "";
  for (const m of messages ?? []) {
    if (m?.role !== "assistant") continue;
    if (typeof m.content === "string") out += m.content;
    else if (Array.isArray(m.content)) {
      for (const c of m.content) if (c?.type === "text") out += c.text ?? "";
    }
  }
  return out;
}
