import { describe, it, expect } from "vitest";
import { validateSuggestion, canSubmit } from "./review-coverage";

const valid = new Set(["a.ts\t10", "a.ts\t11", "a.ts\t12", "b.ts\t5"]);

describe("validateSuggestion", () => {
  it("accepts a commentable single line", () => {
    expect(validateSuggestion(valid, { path: "a.ts", line: 10, body: "x" }).ok).toBe(true);
  });
  it("rejects an empty body", () => {
    const v = validateSuggestion(valid, { path: "a.ts", line: 10, body: "  " });
    expect(v.ok).toBe(false);
  });
  it("rejects a non-commentable line", () => {
    const v = validateSuggestion(valid, { path: "a.ts", line: 99, body: "x" });
    expect(v.ok).toBe(false);
  });
  it("keeps a valid range", () => {
    const v = validateSuggestion(valid, { path: "a.ts", line: 12, startLine: 10, body: "x" });
    expect(v).toEqual({ ok: true, startLine: 10 });
  });
  it("downgrades a broken range to single line", () => {
    const v = validateSuggestion(valid, { path: "a.ts", line: 10, startLine: 5, body: "x" });
    expect(v).toEqual({ ok: true });
  });
});

describe("canSubmit", () => {
  it("blocks when files remain", () => {
    expect(canSubmit({ remaining: ["a.ts"], decision: "approve", suggestionCount: 0 }).ok).toBe(false);
  });
  it("blocks approve with suggestions", () => {
    expect(canSubmit({ remaining: [], decision: "approve", suggestionCount: 2 }).ok).toBe(false);
  });
  it("blocks suggestions with none", () => {
    expect(canSubmit({ remaining: [], decision: "suggestions", suggestionCount: 0 }).ok).toBe(false);
  });
  it("allows a clean approve", () => {
    expect(canSubmit({ remaining: [], decision: "approve", suggestionCount: 0 }).ok).toBe(true);
  });
  it("allows suggestions with items", () => {
    expect(canSubmit({ remaining: [], decision: "suggestions", suggestionCount: 3 }).ok).toBe(true);
  });
});
