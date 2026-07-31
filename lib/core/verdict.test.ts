import { describe, it, expect } from "vitest";
import { extractVerdictJson, parseVerdict } from "./verdict";

describe("extractVerdictJson", () => {
  it("extracts a plain decision object", () => {
    const t = '{"decision":"approve","summary":"lgtm","comments":[]}';
    expect(extractVerdictJson(t)).toBe(t);
  });
  it("strips markdown fences", () => {
    const t = '```json\n{"decision":"approve","summary":"lgtm","comments":[]}\n```';
    expect(extractVerdictJson(t)).toContain('"decision":"approve"');
  });
  it("picks the last decision object amid prose", () => {
    const t =
      'note {"decision":"suggestions","summary":"a","comments":[]} then {"decision":"approve","summary":"lgtm","comments":[]} end';
    expect(extractVerdictJson(t)).toContain('"approve"');
  });
  it("ignores braces inside strings", () => {
    const t = '{"decision":"approve","summary":"use { and }","comments":[]}';
    expect(extractVerdictJson(t)).toBe(t);
  });
  it("returns null when no decision object exists", () => {
    expect(extractVerdictJson("no json here")).toBeNull();
  });
});

describe("parseVerdict", () => {
  it("parses a suggestions verdict and drops malformed comments", () => {
    const t =
      '{"decision":"suggestions","summary":"see below","comments":[{"path":"a.ts","line":3,"side":"RIGHT","body":"consider x"},{"path":"","line":1,"body":"bad"}]}';
    const v = parseVerdict(t);
    expect(v?.decision).toBe("suggestions");
    expect(v?.comments).toHaveLength(1);
    expect(v?.comments[0].path).toBe("a.ts");
  });
  it("returns null on invalid json", () => {
    expect(parseVerdict("{ not json")).toBeNull();
  });
});
