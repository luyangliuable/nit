import type { ReviewVerdict, ReviewComment } from "@/lib/shared/types";

// Port of the verdict extraction in run_pi_review. Strips markdown fences, then
// scans for balanced {...} objects and returns the LAST one that contains a
// "decision" key. Tolerant of surrounding prose or trailing text.

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "");
}

// Return all balanced brace objects in the text, in order of appearance.
function balancedObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objects;
}

export function extractVerdictJson(text: string): string | null {
  const cleaned = stripFences(text);
  const objects = balancedObjects(cleaned);
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].includes('"decision"')) return objects[i];
  }
  return null;
}

// Parse and normalize a verdict. Returns null when the text has no valid
// decision object or the JSON does not parse.
export function parseVerdict(text: string): ReviewVerdict | null {
  const json = extractVerdictJson(text);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;
  const decision = obj.decision === "approve" ? "approve" : "suggestions";
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const comments: ReviewComment[] = [];

  if (Array.isArray(obj.comments)) {
    for (const c of obj.comments) {
      if (typeof c !== "object" || c === null) continue;
      const cc = c as Record<string, unknown>;
      const path = typeof cc.path === "string" ? cc.path : "";
      const line = typeof cc.line === "number" ? cc.line : Number(cc.line);
      const body = typeof cc.body === "string" ? cc.body : "";
      if (path === "" || !Number.isFinite(line) || body === "") continue;
      comments.push({ path, line, side: "RIGHT", body });
    }
  }

  return { decision, summary, comments };
}
