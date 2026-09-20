import { describe, it, expect } from "vitest";
import {
  analyzeDiff,
  deterministicVisualization,
  normalizeVisualization,
  parseVisualization,
} from "./visualization";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/tests/a.test.ts b/tests/a.test.ts
--- a/tests/a.test.ts
+++ b/tests/a.test.ts
@@ -0,0 +1,1 @@
+test("a", () => {});
`;

describe("analyzeDiff", () => {
  it("counts added and removed lines per file", () => {
    const files = analyzeDiff(DIFF);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: "src/a.ts", added: 2, removed: 1 });
    expect(files[1]).toMatchObject({ path: "tests/a.test.ts", added: 1, removed: 0 });
  });

  it("returns nothing for an empty diff", () => {
    expect(analyzeDiff("")).toEqual([]);
  });
});

describe("parseVisualization", () => {
  it("parses JSON wrapped in a code fence", () => {
    const text = '```json\n{"blocks":[{"kind":"bar","data":[{"label":"a","value":2}]}]}\n```';
    const viz = parseVisualization(text);
    expect(viz?.blocks).toHaveLength(1);
    expect(viz?.blocks[0]).toMatchObject({ kind: "bar" });
  });

  it("rejects prose without a JSON object", () => {
    expect(parseVisualization("This PR makes things better.")).toBeNull();
  });

  it("drops malformed blocks and keeps the rest", () => {
    const viz = normalizeVisualization({
      blocks: [
        { kind: "bar", data: [{ label: "x", value: 1 }] },
        { kind: "bar", data: [] },
        { kind: "nonsense" },
      ],
    });
    expect(viz?.blocks).toHaveLength(1);
  });

  it("caps item counts", () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ label: `f${i}`, value: i }));
    const viz = normalizeVisualization({ blocks: [{ kind: "bar", data }] });
    const block = viz?.blocks[0];
    expect(block && block.kind === "bar" ? block.data.length : 0).toBeLessThanOrEqual(24);
  });
});

describe("deterministicVisualization", () => {
  it("builds charts and a table straight from the diff", () => {
    const viz = deterministicVisualization(DIFF, "PR #1");
    const kinds = viz.blocks.map((b) => b.kind);
    expect(viz.title).toBe("PR #1");
    expect(kinds).toContain("stats");
    expect(kinds).toContain("stacked");
    expect(kinds).toContain("table");
  });

  it("reports totals in the stats block", () => {
    const viz = deterministicVisualization(DIFF);
    const stats = viz.blocks.find((b) => b.kind === "stats");
    const value = (label: string) =>
      stats && stats.kind === "stats" ? stats.stats.find((s) => s.label === label)?.value : undefined;
    expect(value("Files")).toBe(2);
    expect(value("Added")).toBe(3);
    expect(value("Removed")).toBe(1);
  });
});