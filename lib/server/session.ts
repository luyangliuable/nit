import fs from "node:fs";
import {
  type SessionConfig,
  type SessionSnapshot,
  type ApprovalItem,
  type QueuedComment,
  type NotificationKind,
  type ReviewOverrides,
  type ChatStreamEvent,
  type TranscriptBlock,
} from "@/lib/shared/types";
import {
  stateKey,
  lastCompletedForPr,
  shouldReview,
  type StateStore,
} from "@/lib/core/state";
import { validRightLines, isCommentableLine, isCommentableRange, filterDiff, lineRegion } from "@/lib/core/diff";
import { sanitizeText } from "@/lib/core/sanitize";
import {
  currentLogin,
  listOpenPrs,
  listOpenPrsByAuthor,
  viewPr,
  reviewThreads,
  headCommitDate,
  postApprove,
  postSuggestions,
  prDiff,
  type PrListItem,
} from "./gh";
import { reviewPr, generateVisualization } from "./review";
import { readReviewTranscript } from "./pi";
import { githubAuthStatus } from "./octokit";
import { reviewSemaphore } from "./semaphore";
import { SessionLogger } from "./logger";
import { hub } from "./events";
import { readJson, writeJson } from "./store";
import { stateFile, sessionDir, visualizationFile, reviewSessionDir } from "./paths";

type Queue = Record<string, ApprovalItem>;

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export class Session {
  config: SessionConfig;
  private state: StateStore;
  private queue: Queue;
  private logger: SessionLogger;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private me = "";
  private lastPollAt: string | undefined;
  private unread = 0;
  // Abort controllers for in-flight reviews, keyed by queue key, so a review
  // can be stopped on demand.
  private running = new Map<string, AbortController>();

  constructor(config: SessionConfig) {
    this.config = config;
    this.state = readJson<StateStore>(stateFile(config.id), {});
    this.queue = readJson<Queue>(this.queueFile(), {});
    // A fresh process has no in-flight reviews, so any item persisted as
    // "reviewing" is a zombie from a prior run. Mark it interrupted so it is no
    // longer stuck and the poller can re-review it.
    for (const item of Object.values(this.queue)) {
      if (item.status === "reviewing") {
        item.status = "error";
        item.error = "interrupted";
      }
    }
    this.logger = new SessionLogger(config.id, (line, pr) =>
      hub.publish({ type: "log", sessionId: config.id, line, pr }),
    );
  }

  private queueFile(): string {
    return `${sessionDir(this.config.id)}/queue.json`;
  }

  // ---- snapshot and events -------------------------------------------------

  snapshot(): SessionSnapshot {
    return {
      config: this.config,
      pollerRunning: this.pollTimer !== null,
      lastPollAt: this.lastPollAt,
      queue: Object.values(this.queue).sort((a, b) => {
        // Primary sort: lastCommitDate descending
        if (a.lastCommitDate && b.lastCommitDate) {
          return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
        }
        // Secondary sort: updatedAt descending (for items with no commit date)
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
      unreadCount: this.unread,
    };
  }

  private emit(): void {
    hub.publish({ type: "session_update", session: this.snapshot() });
  }

  private notify(kind: NotificationKind, title: string, body: string): void {
    hub.publish({
      type: "notification",
      sessionId: this.config.id,
      kind,
      title,
      body,
    });
  }

  private persistQueue(): Promise<void> {
    return writeJson(this.queueFile(), this.queue);
  }
  private persistState(): Promise<void> {
    return writeJson(stateFile(this.config.id), this.state);
  }

  logTail(): string[] {
    return this.logger.tail();
  }

  // Full review transcript (thinking, response, tool calls) for a PR, read from
  // the persisted pi session so it survives restarts and re-selection.
  reviewTranscript(pr: number): Promise<TranscriptBlock[]> {
    const cwd = this.config.localPath?.trim() ? this.config.localPath : process.cwd();
    return readReviewTranscript(reviewSessionDir(this.config.id, pr), cwd);
  }

  // Broadcast a live review stream event to open consoles. History is durable
  // via the persisted pi session, so nothing is buffered here.
  private pushReviewStream(pr: number, event: ChatStreamEvent): void {
    hub.publish({ type: "review_stream", sessionId: this.config.id, pr, event });
  }

  // ---- config --------------------------------------------------------------

  updateConfig(patch: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...patch, id: this.config.id };
    this.emit();
  }

  markRead(): void {
    this.unread = 0;
    this.emit();
  }

  // ---- poller lifecycle ----------------------------------------------------

  start(): void {
    if (this.pollTimer) return;
    this.logger.log(
      `started repo=${this.config.repo} interval=${this.config.interval}s debounce=${this.config.debounceMinutes}m skills=${this.config.skills.length}`,
    );
    const tick = () => {
      void this.pollCycle();
    };
    this.pollTimer = setInterval(tick, this.config.interval * 1000);
    tick();
    this.emit();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.log("stopped");
      this.emit();
    }
  }

  async dispose(): Promise<void> {
    this.stop();
  }

  // ---- polling -------------------------------------------------------------

  private whitelistEnabled(): boolean {
    return (
      this.config.whitelistAuthors.length > 0 ||
      this.config.whitelistPrs.length > 0
    );
  }

  private async gatherPrs(): Promise<PrListItem[]> {
    if (!this.whitelistEnabled()) {
      return listOpenPrs(this.config.repo);
    }
    const byNumber = new Map<number, PrListItem>();
    for (const author of this.config.whitelistAuthors) {
      try {
        for (const pr of await listOpenPrsByAuthor(this.config.repo, author)) {
          byNumber.set(pr.number, pr);
        }
      } catch (err) {
        this.logger.log(`ERROR author=${author} reason=pr-list-failed ${String(err)}`);
      }
    }
    for (const num of this.config.whitelistPrs) {
      const pr = await viewPr(this.config.repo, num);
      if (pr) byNumber.set(pr.number, pr);
      else this.logger.log(`WARN pr=#${num} reason=whitelist-pr-view-failed`, Number(num));
    }
    return [...byNumber.values()];
  }

  private isBlacklisted(login: string): boolean {
    const l = login.toLowerCase();
    return this.config.blacklistAuthors.some((a) => a.toLowerCase() === l);
  }

  async pollCycle(): Promise<void> {
    if (this.polling) return;
    if (!this.config.repo) return;
    this.polling = true;
    try {
      if (!this.me) this.me = await currentLogin();
      const prs = await this.gatherPrs();
      this.lastPollAt = new Date().toISOString();

      for (const pr of prs) {
        try {
          await this.considerPr(pr);
        } catch (err) {
          this.logger.log(`ERROR pr=#${pr.number} reason=consider-failed ${String(err)}`, pr.number);
        }
      }
      this.emit();
    } catch (err) {
      this.logger.log(`ERROR reason=poll-failed ${String(err)}`);
    } finally {
      this.polling = false;
    }
  }

  private ageDays(createdAt: string): number {
    return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  }

  private async considerPr(pr: PrListItem): Promise<void> {
    const { repo } = this.config;

    if (pr.mergedAt) return;
    if (pr.isDraft) return;
    if (this.ageDays(pr.createdAt) > this.config.maxAgeDays) return;
    if (!this.config.includeOwn && pr.author.login === this.me) return;
    if (this.isBlacklisted(pr.author.login)) return;

    const key = stateKey(repo, pr.number, pr.headRefOid);

    // Already completed at this sha, or already queued and awaiting a human.
    const existing = this.queue[key];
    if (existing && (existing.status === "reviewing" || existing.status === "pending")) {
      return;
    }
    const stateRec = this.state[key];
    const alreadyReviewedThisSha = !!stateRec && stateRec.outcome != null;

    const last = lastCompletedForPr(this.state, repo, pr.number);
    let allResolved = false;
    if (last && (last.thread_ids?.length ?? 0) > 0 && pr.headRefOid !== last.sha) {
      allResolved = await this.allThreadsResolved(pr.number);
    }

    const gate = shouldReview({
      currentSha: pr.headRefOid,
      alreadyReviewedThisSha,
      last,
      allThreadsResolved: allResolved,
    });
    if (!gate.review) return;

    // Debounce on head commit age.
    if (this.config.debounceMinutes > 0) {
      const date = await headCommitDate(repo, pr.headRefOid);
      if (date) {
        const ageMin = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
        if (ageMin < this.config.debounceMinutes) {
          this.logger.log(
            `SKIP pr=#${pr.number} reason=debounce age_min=${ageMin} need=${this.config.debounceMinutes}`,
            pr.number,
          );
          return;
        }
      } else {
        this.logger.log(`WARN pr=#${pr.number} reason=commit-age-fetch-failed action=review-anyway`, pr.number);
      }
    }

    const isNewCommit = !!last && last.sha !== pr.headRefOid;
    if (isNewCommit && this.config.notifyOnNewCommit) {
      this.notify("new_commit", `New commit on PR #${pr.number}`, pr.title);
    } else if (!last && this.config.notifyOnNewPr) {
      this.notify("new_pr", `New PR #${pr.number}`, pr.title);
    }

    await this.reviewOne(pr, key);
  }

  private async allThreadsResolved(pr: number): Promise<boolean> {
    try {
      const threads = await reviewThreads(this.config.repo, pr);
      const mine = threads.filter((t) => t.firstAuthor === this.me);
      const resolved = mine.filter((t) => t.isResolved);
      return mine.length >= 1 && mine.length === resolved.length;
    } catch {
      return false;
    }
  }

  private async reviewOne(pr: PrListItem, key: string, overrides?: ReviewOverrides): Promise<void> {
    // Gate on GitHub auth: without it the review agent's pr_* tools cannot read
    // the PR, so fail fast with a clear error instead of a confusing tool error.
    const authStatus = await githubAuthStatus();
    if (!authStatus.ok) {
      const ts = new Date().toISOString();
      const base: ApprovalItem = this.queue[key] ?? {
        key,
        pr: pr.number,
        sha: pr.headRefOid,
        title: pr.title,
        author: pr.author.login,
        createdAt: pr.createdAt,
        lastCommitDate: null,
        summary: "",
        comments: [],
        hasVisualization: false,
        status: "error",
      };
      this.queue[key] = { ...base, updatedAt: ts, status: "error", error: "github-auth" };
      await this.persistQueue();
      this.emit();
      this.logger.log(`ERROR pr=#${pr.number} reason=github-auth`, pr.number);
      if (this.config.notifyOnVerdict) {
        this.notify("error", `Review blocked for PR #${pr.number}`, authStatus.error ?? "GitHub not authenticated");
      }
      return;
    }

    const now = new Date().toISOString();
    // PR head commit date from GitHub (ISO string) or null if the lookup fails.
    const lastCommitDate = await headCommitDate(this.config.repo, pr.headRefOid);
    const usedModel = overrides?.model ?? this.config.reviewModel ?? this.config.model;
    // Apply one-off overrides on top of the session config for this run.
    const effectiveConfig: SessionConfig = {
      ...this.config,
      reviewModel: usedModel,
      maxAttempts: overrides?.maxAttempts ?? this.config.maxAttempts,
      skills: overrides?.skills ?? this.config.skills,
      appendPrompt: overrides?.appendPrompt ?? this.config.appendPrompt,
    };
    this.queue[key] = {
      key,
      pr: pr.number,
      sha: pr.headRefOid,
      title: pr.title,
      author: pr.author.login,
      createdAt: pr.createdAt,
      updatedAt: now,
      lastCommitDate,
      status: "reviewing",
      reviewingWith: usedModel.model,
      reviewInfo: {
        model: usedModel,
        skills: effectiveConfig.skills,
        appendPrompt: effectiveConfig.appendPrompt,
        diffCapBytes: effectiveConfig.diffCapBytes,
        maxAttempts: effectiveConfig.maxAttempts,
        ranAt: now,
      },
      summary: "",
      comments: [],
      hasVisualization: false,
    };
    await this.persistQueue();
    this.emit();
    this.logger.log(`REVIEWING repo=${this.config.repo} pr=#${pr.number} sha=${pr.headRefOid.slice(0, 12)}`, pr.number);

    // Start a fresh persisted transcript so a re-review does not stack on old
    // runs; readReviewTranscript reads the most recent session in this dir.
    const transcriptDir = reviewSessionDir(this.config.id, pr.number);
    fs.rmSync(transcriptDir, { recursive: true, force: true });

    const ctrl = new AbortController();
    this.running.set(key, ctrl);
    const result = await reviewSemaphore.run(() =>
      reviewPr(effectiveConfig, pr, {
        signal: ctrl.signal,
        onLog: (m) => this.logger.log(`pi pr=#${pr.number} ${m}`, pr.number),
        onStream: (event) => this.pushReviewStream(pr.number, event),
        sessionDir: transcriptDir,
      }),
    );
    this.running.delete(key);
    // If the user stopped this review, stopReview already set the item state;
    // do not overwrite it with the (now irrelevant) late result.
    if (ctrl.signal.aborted) return;
    const item = this.queue[key];
    if (!item) return;

    if (result.error || !result.verdict) {
      item.status = "error";
      item.error = result.error ?? "unknown";
      item.updatedAt = new Date().toISOString();
      await this.persistQueue();
      this.emit();
      this.logger.log(`ERROR pr=#${pr.number} reason=${item.error}`, pr.number);
      if (this.config.notifyOnVerdict) {
        this.notify("error", `Review failed for PR #${pr.number}`, item.error);
      }
      return;
    }

    item.decision = result.verdict.decision;
    item.summary = sanitizeText(result.verdict.summary);
    item.comments = result.verdict.comments.map<QueuedComment>((c) => ({
      ...c,
      body: sanitizeText(c.body),
      originalBody: sanitizeText(c.body),
      id: randomId(),
      status: "pending",
      codeContext: lineRegion(result.diff, c.path, c.line, c.startLine),
    }));
    item.status = "pending";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(
      `VERDICT pr=#${pr.number} decision=${item.decision} comments=${item.comments.length}`,
      pr.number,
    );

    // Generate the visualization alongside the verdict (also capped).
    void reviewSemaphore
      .run(() => generateVisualization(this.config, pr, result.diff))
      .then(async (viz) => {
        const it = this.queue[key];
        if (!it) return;
        if (viz.path) {
          it.hasVisualization = true;
          it.updatedAt = new Date().toISOString();
          await this.persistQueue();
          this.emit();
        } else if (viz.error) {
          this.logger.log(`WARN pr=#${pr.number} reason=${viz.error}`, pr.number);
        }
      });

    this.unread++;
    if (this.config.notifyOnVerdict) {
      this.notify(
        "verdict",
        `Review ready for PR #${pr.number}`,
        item.decision === "approve" ? "Ready to approve" : `${item.comments.length} suggestion(s)`,
      );
    }
  }

  // Re-run the review for an item already in the queue, optionally with a
  // different model. Fetches fresh PR data so the current diff is reviewed.
  async reReview(key: string, overrides?: ReviewOverrides): Promise<{ ok: boolean; error?: string }> {
    const item = this.queue[key];
    if (!item) return { ok: false, error: "not-found" };
    if (item.status === "reviewing") return { ok: false, error: "already-reviewing" };
    // Prefer fresh PR data, but fall back to the cached queue item if the
    // GitHub lookup fails (their API is often flaky) so a rerun still proceeds
    // instead of silently doing nothing.
    let pr = await viewPr(this.config.repo, String(item.pr));
    if (!pr) {
      this.logger.log(`RE-REVIEW pr=#${item.pr} warn=pr-view-failed using-cached`, item.pr);
      pr = {
        number: item.pr,
        title: item.title,
        body: "",
        headRefOid: item.sha,
        isDraft: false,
        mergedAt: null,
        author: { login: item.author },
        createdAt: item.createdAt,
      };
    }
    this.logger.log(`RE-REVIEW pr=#${item.pr}${overrides?.model ? ` model=${overrides.model.model}` : ""}`, item.pr);
    await this.reviewOne(pr, key, overrides);
    return { ok: true };
  }

  // Abort an in-flight review. The run resolves to an error state, which the
  // user can re-review to restart.
  stopReview(key: string): void {
    // Abort the live run if one exists. If not (e.g. a zombie "reviewing" item
    // left over from a restart), we still clear the state below.
    const ctrl = this.running.get(key);
    if (ctrl) ctrl.abort();
    // Flip the item out of "reviewing" immediately so the UI reflects the stop
    // even if the model request keeps running in the background.
    const item = this.queue[key];
    if (item && item.status === "reviewing") {
      item.status = "error";
      item.error = "stopped";
      item.updatedAt = new Date().toISOString();
      // Record a completed state for this sha so the poller's gate does not
      // immediately re-review it. Manual Re-review bypasses the gate.
      this.recordState(item, "stopped", []);
      void this.persistQueue();
      this.emit();
    }
    this.logger.log(`STOP pr=#${item?.pr ?? "?"}`, item?.pr);
  }

  // ---- human actions -------------------------------------------------------

  keepComment(key: string, commentId: string, keep: boolean): void {
    const item = this.queue[key];
    if (!item) return;
    const c = item.comments.find((x) => x.id === commentId);
    if (!c) return;
    c.status = keep ? "kept" : "deleted";
    void this.persistQueue();
    this.emit();
  }

  editComment(key: string, commentId: string, body: string): void {
    const item = this.queue[key];
    if (!item) return;
    const c = item.comments.find((x) => x.id === commentId);
    if (!c) return;
    c.body = sanitizeText(body);
    void this.persistQueue();
    this.emit();
  }

  async approve(key: string): Promise<{ ok: boolean; error?: string }> {
    const item = this.queue[key];
    if (!item) return { ok: false, error: "not-found" };
    const res = await postApprove(this.config.repo, item.pr, item.summary || "lgtm");
    if (!res.ok) {
      this.logger.log(`ERROR pr=#${item.pr} reason=approve-post-failed ${res.error ?? ""}`, item.pr);
      return res;
    }
    this.recordState(item, "approve", []);
    item.status = "approved";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(`REVIEW repo=${this.config.repo} pr=#${item.pr} outcome=approve comments=0`, item.pr);
    return { ok: true };
  }

  async postSuggestionsAction(key: string): Promise<{ ok: boolean; error?: string }> {
    const item = this.queue[key];
    if (!item) return { ok: false, error: "not-found" };

    // Re-validate kept comments against the current diff, exactly like the
    // original before posting, so the atomic reviews call does not 422.
    const rawDiff = await prDiff(this.config.repo, item.pr);
    if (rawDiff === null) return { ok: false, error: "diff-fetch-failed" };
    const valid = validRightLines(filterDiff(rawDiff, 2000));

    const toPost = item.comments
      .filter((c) => c.status !== "deleted")
      .map((c) => {
        const base = { path: c.path, line: c.line, side: "RIGHT" as const, body: sanitizeText(c.body) };
        // Keep the multi-line anchor only when the whole span is in one hunk;
        // otherwise silently downgrade to a single-line comment.
        if (c.startLine !== undefined && isCommentableRange(valid, c.path, c.startLine, c.line)) {
          return { ...base, start_line: c.startLine, start_side: "RIGHT" as const };
        }
        if (c.startLine !== undefined) {
          this.logger.log(`DOWNGRADED pr=#${item.pr} path=${c.path} start=${c.startLine} line=${c.line} reason=range-not-in-diff`, item.pr);
        }
        return base;
      })
      .filter((c) => {
        if (c.body === "") return false;
        if (!isCommentableLine(valid, c.path, c.line)) {
          this.logger.log(`DROPPED pr=#${item.pr} path=${c.path} line=${c.line} reason=not-in-diff`, item.pr);
          return false;
        }
        return true;
      });

    if (toPost.length === 0) return { ok: false, error: "no-valid-comments" };

    const res = await postSuggestions(this.config.repo, item.pr, item.sha, toPost);
    if (!res.ok) {
      this.logger.log(`ERROR pr=#${item.pr} reason=review-post-failed ${res.error ?? ""}`, item.pr);
      return { ok: false, error: res.error };
    }
    this.recordState(item, "suggestions", res.threadIds);
    item.status = "posted";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(`REVIEW repo=${this.config.repo} pr=#${item.pr} outcome=suggestions comments=${toPost.length}`, item.pr);
    return { ok: true };
  }

  async dismiss(key: string): Promise<void> {
    const item = this.queue[key];
    if (!item) return;
    // Record a completed state with no threads so the gate does not re-review
    // this sha. Nothing is posted to GitHub.
    this.recordState(item, "dismissed", []);
    item.status = "dismissed";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(`DISMISSED repo=${this.config.repo} pr=#${item.pr}`, item.pr);
  }

  private recordState(item: ApprovalItem, outcome: string, threadIds: number[]): void {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    this.state[item.key] = {
      outcome,
      at,
      pr: item.pr,
      sha: item.sha,
      thread_ids: threadIds,
      attempts: 0,
    };
    void this.persistState();
  }

  readVisualization(pr: number, sha: string): string | null {
    try {
      return fs.readFileSync(visualizationFile(this.config.id, pr, sha), "utf8");
    } catch {
      return null;
    }
  }
}
