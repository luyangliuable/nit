import { describe, it, expect } from "vitest";
import { stateKey, lastCompletedForPr, shouldReview, type StateStore } from "./state";

describe("stateKey", () => {
  it("builds repo#pr@sha", () => {
    expect(stateKey("owner/name", 12, "abc")).toBe("owner/name#12@abc");
  });
});

describe("lastCompletedForPr", () => {
  const store: StateStore = {
    "owner/name#5@aaa": { outcome: "approve", at: "2026-01-01 10:00:00", pr: 5, sha: "aaa", attempts: 0 },
    "owner/name#5@bbb": { outcome: "suggestions", at: "2026-01-02 10:00:00", pr: 5, sha: "bbb", thread_ids: [1], attempts: 0 },
    "owner/name#5@ccc": { pr: 5, sha: "ccc", attempts: 1 }, // failed attempt, no outcome
    "other/repo#5@zzz": { outcome: "approve", at: "2026-01-03 10:00:00", pr: 5, sha: "zzz", attempts: 0 },
  };
  it("returns the newest completed record for the repo and pr", () => {
    const rec = lastCompletedForPr(store, "owner/name", 5);
    expect(rec?.sha).toBe("bbb");
  });
  it("ignores other repos and failed attempts", () => {
    const rec = lastCompletedForPr(store, "owner/name", 5);
    expect(rec?.outcome).toBe("suggestions");
  });
});

describe("shouldReview", () => {
  const base = { reviewRequestedForMe: false };
  it("reviews a never seen PR", () => {
    expect(shouldReview({ ...base, currentSha: "x", alreadyReviewedThisSha: false, last: null, allThreadsResolved: false }).review).toBe(true);
  });
  it("skips a sha already reviewed", () => {
    const d = shouldReview({ ...base, currentSha: "x", alreadyReviewedThisSha: true, last: null, allThreadsResolved: true });
    expect(d.review).toBe(false);
  });
  it("re-reviews a clean approve on a new commit", () => {
    const last = { outcome: "approve", pr: 1, sha: "old", thread_ids: [], attempts: 0 };
    const d = shouldReview({ ...base, currentSha: "new", alreadyReviewedThisSha: false, last, allThreadsResolved: false });
    expect(d.review).toBe(true);
  });
  it("never re-reviews without a new commit, even if re-requested or resolved", () => {
    const last = { outcome: "suggestions", pr: 1, sha: "same", thread_ids: [1], attempts: 0 };
    expect(shouldReview({ currentSha: "same", alreadyReviewedThisSha: false, last, allThreadsResolved: true, reviewRequestedForMe: true }).review).toBe(false);
  });
  it("skips a new commit with unresolved threads and no re-request", () => {
    const last = { outcome: "suggestions", pr: 1, sha: "old", thread_ids: [1], attempts: 0 };
    const d = shouldReview({ ...base, currentSha: "new", alreadyReviewedThisSha: false, last, allThreadsResolved: false });
    expect(d.review).toBe(false);
  });
  it("re-reviews on a new commit with resolved threads", () => {
    const last = { outcome: "suggestions", pr: 1, sha: "old", thread_ids: [1], attempts: 0 };
    const d = shouldReview({ ...base, currentSha: "new", alreadyReviewedThisSha: false, last, allThreadsResolved: true });
    expect(d.review).toBe(true);
  });
  it("re-reviews on a new commit when my review is re-requested", () => {
    const last = { outcome: "suggestions", pr: 1, sha: "old", thread_ids: [1], attempts: 0 };
    const d = shouldReview({ currentSha: "new", alreadyReviewedThisSha: false, last, allThreadsResolved: false, reviewRequestedForMe: true });
    expect(d.review).toBe(true);
  });
});
