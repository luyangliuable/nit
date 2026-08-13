// Pure logic for the tool-driven review flow: validating an incremental
// suggestion against the diff, and gating submit_review on full coverage.
import { isCommentableLine, isCommentableRange } from "./diff";

export interface SuggestionInput {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

export type Validation = { ok: true; startLine?: number } | { ok: false; reason: string };

// Validate a suggestion's anchor against the RIGHT-side commentable lines.
// A multi-line range that is not fully in one hunk is downgraded to a single
// line (startLine dropped) rather than rejected, matching the posting rules.
export function validateSuggestion(valid: Set<string>, s: SuggestionInput): Validation {
  if (!s.body || s.body.trim() === "") return { ok: false, reason: "empty body" };
  if (!Number.isFinite(s.line)) return { ok: false, reason: "line must be a number" };
  if (!isCommentableLine(valid, s.path, s.line)) {
    return { ok: false, reason: `line ${s.line} of ${s.path} is not an added/changed RIGHT-side line in the diff` };
  }
  if (s.startLine !== undefined && !isCommentableRange(valid, s.path, s.startLine, s.line)) {
    return { ok: true }; // downgrade: valid single line, drop the range
  }
  return { ok: true, startLine: s.startLine };
}

export type SubmitCheck = { ok: true } | { ok: false; reason: string };

// Gate submit_review: required context (skills/docs) must be read, every file
// must be reviewed, and the decision must match the presence of suggestions.
export function canSubmit(params: {
  remaining: string[];
  decision: string;
  suggestionCount: number;
  unreadRequired?: string[];
}): SubmitCheck {
  const { remaining, decision, suggestionCount, unreadRequired = [] } = params;
  if (unreadRequired.length > 0) {
    return {
      ok: false,
      reason: `you must read the loaded context first with the read tool. Not yet read: ${unreadRequired.join(", ")}`,
    };
  }
  if (remaining.length > 0) {
    return { ok: false, reason: `not all files reviewed. Remaining: ${remaining.join(", ")}` };
  }
  if (decision !== "approve" && decision !== "suggestions") {
    return { ok: false, reason: 'decision must be "approve" or "suggestions"' };
  }
  if (decision === "approve" && suggestionCount > 0) {
    return { ok: false, reason: "cannot approve with suggestions; remove them or use decision \"suggestions\"" };
  }
  if (decision === "suggestions" && suggestionCount === 0) {
    return { ok: false, reason: 'decision "suggestions" requires at least one suggestion' };
  }
  return { ok: true };
}
