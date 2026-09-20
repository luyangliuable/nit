import { readJson, writeJson } from "./store";
import { APP_CONFIG_FILE } from "./paths";

// Credential storage abstraction. Secrets stay on the server and are never
// returned by Settings APIs. The file-backed implementation intentionally
// matches Nit's existing local-only persistence model.
export interface CredentialStore {
  getGithubToken(): Promise<string | undefined>;
  getGithubUsername(): Promise<string | undefined>;
  setGithub(token: string | undefined, username: string | undefined): Promise<void>;
  getLlmOverride(): Promise<LlmOverride | undefined>;
  setLlmOverride(override: LlmOverride | undefined): Promise<void>;
}

export interface LlmOverride {
  endpoint: string;
  apiKey: string;
}

interface AppConfig {
  githubToken?: string;
  githubUsername?: string;
  llmEndpoint?: string;
  llmApiKey?: string;
}

/** Persist app-scoped credentials locally for Nit. */
class FileCredentialStore implements CredentialStore {
  private config(): AppConfig {
    return readJson<AppConfig>(APP_CONFIG_FILE, {});
  }

  async getGithubToken(): Promise<string | undefined> {
    const token = this.config().githubToken?.trim();
    return token || undefined;
  }

  async getGithubUsername(): Promise<string | undefined> {
    const username = this.config().githubUsername?.trim();
    return username || undefined;
  }

  async setGithub(token: string | undefined, username: string | undefined): Promise<void> {
    const config = this.config();
    if (token?.trim()) config.githubToken = token.trim();
    else delete config.githubToken;
    if (username?.trim()) config.githubUsername = username.trim();
    else delete config.githubUsername;
    await writeJson(APP_CONFIG_FILE, config);
  }

  async getLlmOverride(): Promise<LlmOverride | undefined> {
    const config = this.config();
    const endpoint = config.llmEndpoint?.trim();
    const apiKey = config.llmApiKey?.trim();
    return endpoint && apiKey ? { endpoint, apiKey } : undefined;
  }

  async setLlmOverride(override: LlmOverride | undefined): Promise<void> {
    const config = this.config();
    if (override) {
      config.llmEndpoint = override.endpoint.trim();
      config.llmApiKey = override.apiKey.trim();
    } else {
      delete config.llmEndpoint;
      delete config.llmApiKey;
    }
    await writeJson(APP_CONFIG_FILE, config);
  }
}

export const credentials: CredentialStore = new FileCredentialStore();
