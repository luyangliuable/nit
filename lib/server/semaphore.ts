// Simple FIFO semaphore. Used to cap simultaneous pi review and visualization
// sub sessions across all tabs, so multiple pollers do not hammer the model.

export class Semaphore {
  private available: number;
  private waiters: (() => void)[] = [];

  constructor(private readonly max: number) {
    this.available = max;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available--;
    return () => this.release();
  }

  private release(): void {
    this.available++;
    const next = this.waiters.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// Global cap of 2 concurrent sub sessions, configurable via env.
const globalForSem = globalThis as unknown as { __nitSem?: Semaphore };
export const reviewSemaphore: Semaphore =
  globalForSem.__nitSem ??
  new Semaphore(Number(process.env.NIT_CONCURRENCY ?? "2"));
globalForSem.__nitSem = reviewSemaphore;
