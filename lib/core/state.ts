// State model ported from pr-review-bot.sh. The on disk shape matches the
// original state.json so records stay compatible: keyed by "repo#pr@sha".

import type { ReviewDecision } from "@/lib/shared/types";

export interface StateRecord {
  outcome?: ReviewDecision | string;
  at?: string;
  pr: number;
  sha: string;
  thread_ids?: number[];
  attempts: number;
}

export type StateStore = Record<string, StateRecord>;

export function stateKey(repo: string, pr: number, sha: string): string {
  return `${repo}#${pr}@${sha}`;
}

// Most recent COMPLETED review for a PR regardless of sha. Failed attempts
// (no outcome) are excluded so they do not trip the gate.
export function lastCompletedForPr(
  store: StateStore,
  repo: string,
  pr: number,
): StateRecord | null {
  const prefix = `${repo}#`;
  const candidates = Object.entries(store)
    .filter(
      ([key, rec]) =>
        rec.pr === pr && rec.outcome != null && key.startsWith(prefix),
    )
    .map(([, rec]) => rec)
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

export type GateDecision =
  | { review: true }
  | { review: false; reason: string };

// Strict AND re-review gate from poll_once. A PR already reviewed is only
// re-reviewed when there is a new head commit AND all of the bot threads are
// resolved. A clean approve with no comments is never re-reviewed.
export function shouldReview(params: {
  currentSha: string;
  alreadyReviewedThisSha: boolean;
  last: StateRecord | null;
  allThreadsResolved: boolean;
}): GateDecision {
  const { currentSha, alreadyReviewedThisSha, last, allThreadsResolved } =
    params;

  if (alreadyReviewedThisSha) {
    return { review: false, reason: "already-reviewed-this-sha" };
  }
  if (!last) {
    return { review: true };
  }
  const priorThreads = last.thread_ids?.length ?? 0;
  if (priorThreads === 0) {
    return { review: false, reason: "clean-approve-never-rereviewed" };
  }
  if (currentSha === last.sha) {
    return { review: false, reason: "no-new-commit" };
  }
  if (!allThreadsResolved) {
    return { review: false, reason: "threads-unresolved" };
  }
  return { review: true };
}
