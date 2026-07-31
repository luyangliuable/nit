import { describe, it, expect } from "vitest";
import { normalizeRepo, isValidRepo } from "./normalize";

describe("normalizeRepo", () => {
  it("passes through a bare owner/name", () => {
    expect(normalizeRepo("owner/name")).toBe("owner/name");
  });
  it("strips https and github.com prefix", () => {
    expect(normalizeRepo("https://github.com/owner/name")).toBe("owner/name");
  });
  it("strips a .git suffix", () => {
    expect(normalizeRepo("https://github.com/owner/name.git")).toBe("owner/name");
  });
  it("strips a /pull/N suffix", () => {
    expect(normalizeRepo("https://github.com/owner/name/pull/123")).toBe(
      "owner/name",
    );
  });
  it("strips /pulls and /tree/branch", () => {
    expect(normalizeRepo("github.com/owner/name/pulls")).toBe("owner/name");
    expect(normalizeRepo("owner/name/tree/main/src")).toBe("owner/name");
  });
  it("returns empty for empty input", () => {
    expect(normalizeRepo("   ")).toBe("");
  });
});

describe("isValidRepo", () => {
  it("accepts owner/name", () => {
    expect(isValidRepo("owner/name")).toBe(true);
  });
  it("rejects extra path segments or spaces", () => {
    expect(isValidRepo("owner/name/extra")).toBe(false);
    expect(isValidRepo("owner name")).toBe(false);
    expect(isValidRepo("owner")).toBe(false);
  });
});
