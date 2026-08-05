import { describe, it, expect } from "vitest";
import { filterDiff, validRightLines, isCommentableLine, isCommentableRange, lineRegion } from "./diff";

const SAMPLE = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

describe("validRightLines", () => {
  it("marks added and context lines commentable on the new side", () => {
    const valid = validRightLines(SAMPLE);
    expect(isCommentableLine(valid, "src/app.ts", 1)).toBe(true); // context
    expect(isCommentableLine(valid, "src/app.ts", 2)).toBe(true); // added b=3
    expect(isCommentableLine(valid, "src/app.ts", 3)).toBe(true); // added c=4
    expect(isCommentableLine(valid, "src/app.ts", 4)).toBe(true); // context d
  });
  it("does not mark a line outside the hunk", () => {
    const valid = validRightLines(SAMPLE);
    expect(isCommentableLine(valid, "src/app.ts", 99)).toBe(false);
  });
});

describe("isCommentableRange", () => {
  it("accepts a contiguous range inside one hunk", () => {
    const valid = validRightLines(SAMPLE);
    expect(isCommentableRange(valid, "src/app.ts", 2, 4)).toBe(true);
  });
  it("rejects a range with a gap or outside the hunk", () => {
    const valid = validRightLines(SAMPLE);
    expect(isCommentableRange(valid, "src/app.ts", 3, 5)).toBe(false); // 5 not in diff
  });
  it("rejects a zero-length or inverted range", () => {
    const valid = validRightLines(SAMPLE);
    expect(isCommentableRange(valid, "src/app.ts", 3, 3)).toBe(false);
    expect(isCommentableRange(valid, "src/app.ts", 4, 2)).toBe(false);
  });
});

describe("lineRegion", () => {
  it("covers the referenced range when start is provided", () => {
    const region = lineRegion(SAMPLE, "src/app.ts", 4, 2);
    const lines = region.map((l) => l.line);
    expect(lines).toContain(2);
    expect(lines).toContain(3);
    expect(lines).toContain(4);
  });
  it("falls back to the single target line without a start", () => {
    const region = lineRegion(SAMPLE, "src/app.ts", 3);
    expect(region.some((l) => l.line === 3)).toBe(true);
  });
});

describe("filterDiff", () => {
  it("drops lock file sections", () => {
    const diff = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1 +1 @@
-old
+new
${SAMPLE}`;
    const out = filterDiff(diff);
    expect(out).not.toContain("package-lock.json");
    expect(out).toContain("src/app.ts");
    expect(out).toContain("generated/lock/binary file(s) omitted");
  });
  it("neutralizes pathologically long lines while keeping the prefix", () => {
    const long = "+" + "x".repeat(3000);
    const diff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -0,0 +1 @@
${long}`;
    const out = filterDiff(diff);
    expect(out).toContain("+[long line omitted: 3001 chars]");
  });
});
