import { readJson, writeJson } from "./store";
import { APP_CONFIG_FILE } from "./paths";

// Credential storage abstraction. The whole app talks to a CredentialStore so
// the backing store can be swapped without touching call sites. Today it is a
// JSON file under data/; when this becomes an Electron app, provide an
// Electron implementation (e.g. safeStorage backed) and assign it to
// `credentials` below. Secrets never leave the server.
export interface CredentialStore {
  getGithubToken(): Promise<string | undefined>;
  setGithubToken(token: string | undefined): Promise<void>;
}

interface AppConfig {
  githubToken?: string;
}

// Default file-based store. Plaintext on disk under data/; the Electron build
// should replace this with an OS-keychain / safeStorage implementation.
class FileCredentialStore implements CredentialStore {
  async getGithubToken(): Promise<string | undefined> {
    const cfg = readJson<AppConfig>(APP_CONFIG_FILE, {});
    const t = cfg.githubToken?.trim();
    return t ? t : undefined;
  }

  async setGithubToken(token: string | undefined): Promise<void> {
    const cfg = readJson<AppConfig>(APP_CONFIG_FILE, {});
    if (token && token.trim()) cfg.githubToken = token.trim();
    else delete cfg.githubToken;
    await writeJson(APP_CONFIG_FILE, cfg);
  }
}

// Single instance used across the server. Swap this line in the Electron build.
export const credentials: CredentialStore = new FileCredentialStore();
