import { jsonrepair } from "jsonrepair";
import type { ReviewVerdict, ReviewComment } from "@/lib/shared/types";

// Extract the verdict JSON from model output and normalize it. Only the
// EXTRACTION (locating the verdict object among prose or multiple objects) is
// done here; all REPAIR (markdown fences, unescaped control chars, truncation,
// trailing commas, quotes, etc.) is delegated to jsonrepair.

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

// Return the LAST balanced object that contains a "decision" key, tolerant of
// surrounding prose or trailing text. Markdown fences do not contain braces, so
// they do not affect this scan.
export function extractVerdictJson(text: string): string | null {
  const objects = balancedObjects(text);
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].includes('"decision"')) return objects[i];
  }
  return null;
}

// Strict parse first, then a jsonrepair-assisted parse that handles fences,
// unescaped control chars, truncation, trailing commas, single quotes, etc.
function tryParse(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to repair */
  }
  try {
    return JSON.parse(jsonrepair(candidate));
  } catch {
    return null;
  }
}

// Parse and normalize a verdict. Returns null when the text has no valid
// decision object or the JSON cannot be parsed even after repair.
export function parseVerdict(text: string): ReviewVerdict | null {
  let raw: unknown | null = null;

  // 1. A complete balanced object containing "decision".
  const json = extractVerdictJson(text);
  if (json) raw = tryParse(json);

  // 2. Truncated output: take from the last "decision" object start to the end
  //    and let jsonrepair close the open string/braces.
  if (raw === null) {
    const dIdx = text.lastIndexOf('"decision"');
    if (dIdx >= 0) {
      const start = text.lastIndexOf("{", dIdx);
      if (start >= 0) raw = tryParse(text.slice(start));
    }
  }

  // 3. Last resort: repair the whole output (strips fences, etc.).
  if (raw === null) raw = tryParse(text);

  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;
  if (obj.decision !== "approve" && obj.decision !== "suggestions") return null;
  const decision = obj.decision;
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
      const rawStart =
        typeof cc.start_line === "number" ? cc.start_line : Number(cc.start_line);
      const startLine =
        Number.isFinite(rawStart) && rawStart < line ? rawStart : undefined;
      comments.push(
        startLine === undefined
          ? { path, line, side: "RIGHT", body }
          : { path, line, startLine, side: "RIGHT", body },
      );
    }
  }

  return { decision, summary, comments };
}
