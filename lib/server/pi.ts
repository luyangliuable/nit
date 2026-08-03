import type { ModelSelection } from "@/lib/shared/types";
import { loadPiSdk } from "./pi-sdk";

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

// List models that have valid credentials, for the UI picker.
export async function listAvailableModels(): Promise<
  { provider: string; id: string }[]
> {
  let list: { provider: string; id: string }[] = [];
  try {
    const registry = await getRegistry();
    const models = await registry.getAvailable();
    list = models.map((m: { provider: string; id: string }) => ({
      provider: m.provider,
      id: m.id,
    }));
  } catch {
    list = [];
  }
  // Always append this local MLX model as a placeholder at the end of the list,
  // even when it is not configured, so it can be picked in the dropdown.
  if (!list.some((m) => m.id === PLACEHOLDER_MODEL.id)) {
    list.push({ ...PLACEHOLDER_MODEL });
  }
  return list;
}

const PLACEHOLDER_MODEL = { provider: "mlx", id: "mlx-community/gemma-4-e4b-it-4bit" };

// Run a single read only prompt in a throwaway in memory session and return the
// full assistant text. Used for both the review verdict and the HTML
// visualization sub sessions.
export async function runReadOnlyPrompt(params: {
  prompt: string;
  cwd: string;
  model: ModelSelection;
  skills: string[];
}): Promise<string> {
  const { prompt, cwd, model, skills } = params;
  const sdk = await loadPiSdk();

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
    tools: READ_ONLY_TOOLS,
    resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(),
    authStorage: await getAuth(),
    modelRegistry: await getRegistry(),
  });

  let text = "";
  let errorMessage = "";
  const unsubscribe = session.subscribe((event: unknown) => {
    const ev = event as {
      type: string;
      assistantMessageEvent?: { type: string; delta?: string; error?: unknown; reason?: string };
    };
    if (ev.type === "message_update" && ev.assistantMessageEvent) {
      const ame = ev.assistantMessageEvent;
      if (ame.type === "text_delta") text += ame.delta ?? "";
      if (ame.type === "error") {
        errorMessage = typeof ame.error === "string" ? ame.error : JSON.stringify(ame.error);
      }
    }
  });

  try {
    await session.prompt(prompt, { expandPromptTemplates: false });
  } finally {
    unsubscribe();
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
