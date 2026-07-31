import fs from "node:fs";
import {
  type SessionConfig,
  type SessionSnapshot,
  type ApprovalItem,
  type QueuedComment,
  type NotificationKind,
} from "@/lib/shared/types";
import {
  stateKey,
  lastCompletedForPr,
  shouldReview,
  type StateStore,
} from "@/lib/core/state";
import { validRightLines, isCommentableLine, filterDiff } from "@/lib/core/diff";
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
import { reviewSemaphore } from "./semaphore";
import { SessionLogger } from "./logger";
import { hub } from "./events";
import { readJson, writeJson } from "./store";
import { stateFile, sessionDir, visualizationFile } from "./paths";

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

  constructor(config: SessionConfig) {
    this.config = config;
    this.state = readJson<StateStore>(stateFile(config.id), {});
    this.queue = readJson<Queue>(this.queueFile(), {});
    this.logger = new SessionLogger(config.id, (line) =>
      hub.publish({ type: "log", sessionId: config.id, line }),
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
      queue: Object.values(this.queue).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
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
      else this.logger.log(`WARN pr=#${num} reason=whitelist-pr-view-failed`);
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
          this.logger.log(`ERROR pr=#${pr.number} reason=consider-failed ${String(err)}`);
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
          );
          return;
        }
      } else {
        this.logger.log(`WARN pr=#${pr.number} reason=commit-age-fetch-failed action=review-anyway`);
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

  private async reviewOne(pr: PrListItem, key: string): Promise<void> {
    const now = new Date().toISOString();
    this.queue[key] = {
      key,
      pr: pr.number,
      sha: pr.headRefOid,
      title: pr.title,
      author: pr.author.login,
      createdAt: now,
      updatedAt: now,
      status: "reviewing",
      summary: "",
      comments: [],
      hasVisualization: false,
    };
    await this.persistQueue();
    this.emit();
    this.logger.log(`REVIEWING repo=${this.config.repo} pr=#${pr.number} sha=${pr.headRefOid.slice(0, 12)}`);

    const result = await reviewSemaphore.run(() => reviewPr(this.config, pr));
    const item = this.queue[key];
    if (!item) return;

    if (result.error || !result.verdict) {
      item.status = "error";
      item.error = result.error ?? "unknown";
      item.updatedAt = new Date().toISOString();
      await this.persistQueue();
      this.emit();
      this.logger.log(`ERROR pr=#${pr.number} reason=${item.error}`);
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
    }));
    item.status = "pending";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(
      `VERDICT pr=#${pr.number} decision=${item.decision} comments=${item.comments.length}`,
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
          this.logger.log(`WARN pr=#${pr.number} reason=${viz.error}`);
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
      this.logger.log(`ERROR pr=#${item.pr} reason=approve-post-failed ${res.error ?? ""}`);
      return res;
    }
    this.recordState(item, "approve", []);
    item.status = "approved";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(`REVIEW repo=${this.config.repo} pr=#${item.pr} outcome=approve comments=0`);
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
      .map((c) => ({ path: c.path, line: c.line, side: "RIGHT" as const, body: sanitizeText(c.body) }))
      .filter((c) => {
        if (c.body === "") return false;
        if (!isCommentableLine(valid, c.path, c.line)) {
          this.logger.log(`DROPPED pr=#${item.pr} path=${c.path} line=${c.line} reason=not-in-diff`);
          return false;
        }
        return true;
      });

    if (toPost.length === 0) return { ok: false, error: "no-valid-comments" };

    const res = await postSuggestions(this.config.repo, item.pr, item.sha, toPost);
    if (!res.ok) {
      this.logger.log(`ERROR pr=#${item.pr} reason=review-post-failed ${res.error ?? ""}`);
      return { ok: false, error: res.error };
    }
    this.recordState(item, "suggestions", res.threadIds);
    item.status = "posted";
    item.updatedAt = new Date().toISOString();
    await this.persistQueue();
    this.emit();
    this.logger.log(`REVIEW repo=${this.config.repo} pr=#${item.pr} outcome=suggestions comments=${toPost.length}`);
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
    this.logger.log(`DISMISSED repo=${this.config.repo} pr=#${item.pr}`);
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
