import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Server-side extraction of explicit context requirements from the user-supplied
// append prompt. The model is still instructed to read these files, but this
// resolver lets the tool-driven review gate block PR diff access/submission
// until the referenced docs/skills have actually been opened with read().

export interface LoadedSkillInfo {
  name: string;
  filePath: string;
  baseDir?: string;
}

export interface RequiredContextResult {
  paths: string[];
  unresolved: string[];
}

const DOC_EXTS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const DOC_BASENAMES = new Set(["SKILL.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md", "README.md"]);
const SKIP_DIRS = new Set([".git", ".next", "node_modules", ".venv", "venv", "dist", "build", "data"]);

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function absolutePath(cwd: string, p: string): string {
  return path.resolve(cwd, expandHome(p));
}

function cleanCandidate(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^[`'"(<\[]+/, "").replace(/[`'">)\],;]+$/, "");
  s = s.replace(/:\d+(?::\d+)?$/, "");
  if (s.endsWith(".") && !fs.existsSync(expandHome(s))) s = s.slice(0, -1);
  return s;
}

function isUrl(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith("mailto:") || s.startsWith("#");
}

function isDocFile(p: string): boolean {
  const bn = path.basename(p);
  if (DOC_BASENAMES.has(bn)) return true;
  if (/^README\./i.test(bn)) return true;
  return DOC_EXTS.has(path.extname(p).toLowerCase());
}

function looksContextual(raw: string): boolean {
  return /(^|\/)docs?\//i.test(raw) || /skill/i.test(raw) || /\.(mdx?|txt|rst|adoc)(:\d+)?$/i.test(raw);
}

function walkDocs(dir: string, out: string[], maxFiles: number): void {
  if (out.length >= maxFiles) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkDocs(p, out, maxFiles);
    } else if (entry.isFile() && isDocFile(p)) {
      out.push(path.resolve(p));
    }
  }
}

function addPath(cwd: string, raw: string, paths: Set<string>, unresolved: Set<string>, maxDirectoryFiles: number): void {
  const cleaned = cleanCandidate(raw);
  if (!cleaned || isUrl(cleaned) || /^\/?skill:/i.test(cleaned)) return;

  const abs = absolutePath(cwd, cleaned);
  if (!fs.existsSync(abs)) {
    if (looksContextual(cleaned)) unresolved.add(cleaned);
    return;
  }

  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (isDocFile(abs)) paths.add(path.resolve(abs));
    return;
  }

  if (!st.isDirectory()) return;

  const skillFile = path.join(abs, "SKILL.md");
  if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
    paths.add(path.resolve(skillFile));
    return;
  }

  if (/(^|\/)docs?$/i.test(abs) || /(^|\/)docs?\//i.test(abs)) {
    const docs: string[] = [];
    walkDocs(abs, docs, maxDirectoryFiles);
    for (const p of docs) paths.add(p);
  }
}

function referencedSkillNames(prompt: string): string[] {
  const names = new Set<string>();
  const re = /(?:^|\s)(?:\/skill:|skill:)([a-z0-9][a-z0-9-]{0,63})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) names.add(m[1]);
  return [...names];
}

function pathCandidates(prompt: string): string[] {
  const candidates = new Set<string>();

  // Markdown links/images: [text](docs/foo.md) or ![x](/path/to/SKILL.md)
  const link = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = link.exec(prompt)) !== null) candidates.add(lm[1]);

  // Bare path-like references. Requires a slash or explicit relative/absolute
  // prefix so ordinary prose does not become a required read.
  const bare = /(?:~|\/|\.\.?\/|(?:[A-Za-z0-9._-]+\/)+)[^\s"'`<>)\]}]*/g;
  let bm: RegExpExecArray | null;
  while ((bm = bare.exec(prompt)) !== null) candidates.add(bm[0]);

  // Common shorthand: "read docs" should mean the repo's docs directory.
  if (/(^|\s)docs?(?=$|[\s.,;:])/i.test(prompt)) candidates.add("docs");

  return [...candidates];
}

export function resolveAppendRequiredContext(params: {
  appendPrompt?: string;
  cwd: string;
  loadedSkills?: LoadedSkillInfo[];
  maxDirectoryFiles?: number;
}): RequiredContextResult {
  const prompt = params.appendPrompt ?? "";
  const maxDirectoryFiles = params.maxDirectoryFiles ?? 200;
  const paths = new Set<string>();
  const unresolved = new Set<string>();
  if (prompt.trim() === "") return { paths: [], unresolved: [] };

  const byName = new Map((params.loadedSkills ?? []).map((s) => [s.name, s]));
  for (const name of referencedSkillNames(prompt)) {
    const skill = byName.get(name);
    if (skill?.filePath) paths.add(path.resolve(skill.filePath));
    else unresolved.add(`skill:${name}`);
  }

  for (const raw of pathCandidates(prompt)) {
    addPath(params.cwd, raw, paths, unresolved, maxDirectoryFiles);
  }

  return { paths: [...paths].sort(), unresolved: [...unresolved].sort() };
}
