// Shared type definitions used by both the server (SessionManager, core review
// logic) and the client (React UI). Keep this module free of Node imports so it
// is safe to import from client components.

export type SessionMode = "review" | "implement";

// Per purpose model override. All default to the tab level model when unset.
export interface ModelSelection {
  provider: string;
  model: string;
  thinking: ThinkingLevel;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// Mirrors the pr-review-bot flag surface, one field per flag, plus the new
// fields needed by Nit (localPath, model selection, notifications).
export interface SessionConfig {
  id: string;
  name: string;
  createdAt: string;
  mode: SessionMode;

  // Review mode: the target GitHub repository, normalized to owner/name.
  repo: string;
  // Implement mode: path to an existing local clone. pi cwd is set here.
  localPath: string;

  // Poller flags (defaults match pr-review-bot.sh).
  interval: number; // seconds
  skills: string[]; // absolute paths forwarded to pi
  maxAttempts: number;
  diffCapBytes: number;
  maxAgeDays: number;
  debounceMinutes: number;
  includeOwn: boolean;
  blacklistAuthors: string[];
  whitelistAuthors: string[];
  whitelistPrs: string[];
  appendPrompt: string;

  // Whether the poller should auto resume on server start.
  enabled: boolean;

  // Model selection. Tab level default plus optional per purpose overrides.
  model: ModelSelection;
  reviewModel?: ModelSelection;
  implementModel?: ModelSelection;

  // Notification preferences.
  notifyOnNewPr: boolean;
  notifyOnNewCommit: boolean;
  notifyOnVerdict: boolean;
  sound: boolean;
}

export type ReviewDecision = "approve" | "suggestions";

export interface ReviewComment {
  path: string;
  // The last line of the referenced region (GitHub's anchor line). For a
  // single-line comment this is the only line.
  line: number;
  // Optional first line of a multi-line region. When present it must be less
  // than `line`; both endpoints anchor a GitHub multi-line comment.
  startLine?: number;
  side: "RIGHT";
  body: string;
}

// One line of referenced code shown alongside a suggestion.
export interface CodeLine {
  line: number; // RIGHT side line number
  text: string; // line content, without the +/space diff prefix
  kind: "add" | "context";
}

// A comment as tracked in the approval queue, with per comment human state.
export interface QueuedComment extends ReviewComment {
  id: string;
  status: "pending" | "kept" | "deleted";
  originalBody: string; // as generated, before any human edit
  // The referenced code region (target line plus a little context), extracted
  // from the review diff for display.
  codeContext?: CodeLine[];
}

export interface ReviewVerdict {
  decision: ReviewDecision;
  summary: string;
  comments: ReviewComment[];
}

// The models and config a review run used, captured for display on the PR.
export interface ReviewRunInfo {
  model: ModelSelection;
  skills: string[];
  appendPrompt: string;
  diffCapBytes: number;
  maxAttempts: number;
  ranAt: string;
}

// One-off overrides for a manual re-review run. Any field left undefined falls
// back to the session config.
export interface ReviewOverrides {
  model?: ModelSelection;
  maxAttempts?: number;
  skills?: string[];
  appendPrompt?: string;
}

export type ApprovalStatus =
  | "reviewing" // sub session is running
  | "pending" // verdict ready, waiting for human action
  | "approved" // posted an approve review
  | "posted" // posted suggestion comments
  | "dismissed" // human dropped it, nothing posted
  | "error"; // review failed

// One entry in a session approval queue, keyed logically by repo#pr@sha.
export interface ApprovalItem {
  key: string; // repo#pr@sha
  pr: number;
  sha: string;
  title: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  lastCommitDate: string | null;
  status: ApprovalStatus;
  // Model id the current/most recent review run is using (for display).
  reviewingWith?: string;
  // Snapshot of the models and config the review run used, for display.
  reviewInfo?: ReviewRunInfo;
  decision?: ReviewDecision;
  summary: string;
  comments: QueuedComment[];
  hasVisualization: boolean;
  error?: string;
}

// Snapshot of a session sent to the client over SSE and REST.
export interface SessionSnapshot {
  config: SessionConfig;
  pollerRunning: boolean;
  lastPollAt?: string;
  queue: ApprovalItem[];
  unreadCount: number;
}

// GitHub authentication status, surfaced to the UI to gate reviewing and shown
// on the Settings page. Never carries the token itself.
export interface AuthStatus {
  ok: boolean;
  source: "env" | "stored" | "gh-cli" | "none";
  login?: string;
  error?: string;
}

// Server sent events streamed to the client.
export type ServerEvent =
  | { type: "sessions"; sessions: SessionSnapshot[] }
  | { type: "session_update"; session: SessionSnapshot }
  | { type: "log"; sessionId: string; line: string; pr?: number }
  | { type: "review_stream"; sessionId: string; pr: number; event: ChatStreamEvent }
  | { type: "notification"; sessionId: string; kind: NotificationKind; title: string; body: string }
  | { type: "chat"; sessionId: string; event: ChatStreamEvent }
  | { type: "auth"; status: AuthStatus };

export type NotificationKind = "new_pr" | "new_commit" | "verdict" | "error";

// Chat streaming envelope for Implement mode. The assistant and thinking events
// carry the FULL current text for a given message id (a snapshot, not a delta),
// so the client can upsert by id and duplicate deliveries never double text.
// A rendered block in a transcript. Assistant and thinking blocks are keyed by
// the server assigned message id so full snapshots upsert in place.
export type TranscriptBlock =
  | { key: string; kind: "user"; text: string }
  | { key: string; kind: "assistant"; text: string }
  | { key: string; kind: "thinking"; text: string }
  | { key: string; kind: "tool"; name: string; args: string; status: "running" | "done" | "error" }
  | { key: string; kind: "error"; text: string };

export type ChatStreamEvent =
  | { type: "assistant"; id: number; text: string }
  | { type: "thinking"; id: number; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: string }
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean }
  | { type: "agent_end" }
  | { type: "error"; message: string };

// Matches the pr-review-bot defaults. Opus 4.8 uses adaptive thinking; the
// bundled pi-ai is patched (see patches/) to recognize opus-4-8 so high works.
export const DEFAULT_MODEL: ModelSelection = {
  provider: "portkey-anthropic",
  model: "@bedrock-au/au.anthropic.claude-opus-4-8",
  thinking: "high",
};

// Factory for a fresh session config with pr-review-bot defaults.
export function defaultSessionConfig(id: string, name: string): SessionConfig {
  const now = new Date().toISOString();
  return {
    id,
    name,
    createdAt: now,
    mode: "review",
    repo: "",
    localPath: "",
    interval: 60,
    skills: [],
    maxAttempts: 3,
    diffCapBytes: 200000,
    maxAgeDays: 14,
    debounceMinutes: 0,
    includeOwn: false,
    blacklistAuthors: [],
    whitelistAuthors: [],
    whitelistPrs: [],
    appendPrompt: "",
    enabled: false,
    model: { ...DEFAULT_MODEL },
    notifyOnNewPr: true,
    notifyOnNewCommit: true,
    notifyOnVerdict: true,
    sound: false,
  };
}
