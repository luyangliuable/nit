import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { resolveAppendRequiredContext } from "./required-context";

function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nit-required-context-"));
}

function write(file: string, body = "x"): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return file;
}

describe("resolveAppendRequiredContext", () => {
  it("extracts markdown links and bare docs paths", () => {
    const cwd = tempRepo();
    const a = write(path.join(cwd, "docs/a.md"));
    const b = write(path.join(cwd, "docs/b.mdx"));
    const r = resolveAppendRequiredContext({ appendPrompt: "Read [A](docs/a.md) and docs/b.mdx.", cwd });
    expect(r.paths).toEqual([a, b].map((p) => path.resolve(p)).sort());
    expect(r.unresolved).toEqual([]);
  });

  it("expands docs directories to docs files", () => {
    const cwd = tempRepo();
    const a = write(path.join(cwd, "docs/a.md"));
    const b = write(path.join(cwd, "docs/nested/b.mdx"));
    write(path.join(cwd, "docs/note.json"));
    const r = resolveAppendRequiredContext({ appendPrompt: "Before review, read docs/", cwd });
    expect(r.paths).toEqual([a, b].map((p) => path.resolve(p)).sort());
  });

  it("treats bare docs as the docs directory", () => {
    const cwd = tempRepo();
    const a = write(path.join(cwd, "docs/a.md"));
    const r = resolveAppendRequiredContext({ appendPrompt: "Before review, read docs.", cwd });
    expect(r.paths).toEqual([path.resolve(a)]);
  });

  it("resolves skill directories to SKILL.md", () => {
    const cwd = tempRepo();
    const skill = write(path.join(cwd, "skills/reviewer/SKILL.md"));
    const r = resolveAppendRequiredContext({ appendPrompt: "Use skills/reviewer/", cwd });
    expect(r.paths).toEqual([path.resolve(skill)]);
  });

  it("resolves /skill:name references from loaded skills", () => {
    const cwd = tempRepo();
    const skill = write(path.join(cwd, "reviewer/SKILL.md"));
    const r = resolveAppendRequiredContext({
      appendPrompt: "Use /skill:reviewer before reviewing.",
      cwd,
      loadedSkills: [{ name: "reviewer", filePath: skill }],
    });
    expect(r.paths).toEqual([path.resolve(skill)]);
  });

  it("reports unresolved contextual paths and skill names", () => {
    const cwd = tempRepo();
    const r = resolveAppendRequiredContext({ appendPrompt: "Read docs/missing.md and /skill:nope", cwd });
    expect(r.paths).toEqual([]);
    expect(r.unresolved).toEqual(["docs/missing.md", "skill:nope"]);
  });
});
