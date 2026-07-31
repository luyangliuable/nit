import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./paths";

// A tiny JSON file store that serializes all writes through a per file promise
// chain. Because the whole app runs in one Node process, this in process queue
// is enough to prevent the multi tab write races we discussed.

const writeChains = new Map<string, Promise<void>>();

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): Promise<void> {
  const prev = writeChains.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      ensureDir(path.dirname(file));
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
      await fsp.rename(tmp, file);
    });
  writeChains.set(file, next);
  return next;
}

// Read modify write helper that stays on the serialized chain, so concurrent
// mutations of the same file do not clobber each other.
export function updateJson<T>(
  file: string,
  fallback: T,
  mutate: (current: T) => T,
): Promise<T> {
  const prev = writeChains.get(file) ?? Promise.resolve();
  let result: T = fallback;
  const next = prev
    .catch(() => {})
    .then(async () => {
      const current = readJson<T>(file, fallback);
      result = mutate(current);
      ensureDir(path.dirname(file));
      const tmp = `${file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(result, null, 2), "utf8");
      await fsp.rename(tmp, file);
    });
  writeChains.set(file, next as unknown as Promise<void>);
  return next.then(() => result);
}
