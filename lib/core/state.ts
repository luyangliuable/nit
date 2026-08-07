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

// Queue (sidebar) key: one entry per PR regardless of commit sha, so a new
// commit updates the same row instead of adding a duplicate. State history
// stays keyed per sha via stateKey above.
export function queueKey(repo: string, pr: number): string {
  return `${repo}#${pr}`;
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

// Re-review gate. A given sha is reviewed at most once. Re-review always
// requires a NEW head commit (never same-sha); on a new commit we re-review
// when the prior review was a clean approve, OR my review was re-requested, OR
// all of my prior comment threads are now resolved.
export function shouldReview(params: {
  currentSha: string;
  alreadyReviewedThisSha: boolean;
  last: StateRecord | null;
  allThreadsResolved: boolean;
  reviewRequestedForMe: boolean;
}): GateDecision {
  const { currentSha, alreadyReviewedThisSha, last, allThreadsResolved, reviewRequestedForMe } =
    params;

  if (alreadyReviewedThisSha) {
    return { review: false, reason: "already-reviewed-this-sha" };
  }
  if (!last) {
    return { review: true };
  }
  if (currentSha === last.sha) {
    // No new commit: never re-review, even if re-requested or resolved.
    return { review: false, reason: "no-new-commit" };
  }
  // New commit present.
  const priorThreads = last.thread_ids?.length ?? 0;
  if (priorThreads === 0) {
    return { review: true }; // clean approve + new commit
  }
  if (reviewRequestedForMe) {
    return { review: true }; // new commit + review re-requested
  }
  if (allThreadsResolved) {
    return { review: true }; // new commit + my comments addressed
  }
  return { review: false, reason: "new-commit-unresolved-and-not-requested" };
}
