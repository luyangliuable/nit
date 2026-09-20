// Next.js instrumentation hook. Runs once when the server process boots. This
// replaces the eager manager import in the tsx dev server (server.ts) so the
// standalone production bundle (used by the Electron desktop app) also resumes
// persisted pollers and warms the pi model registry on startup.

export async function register(): Promise<void> {
  // Next inlines NEXT_RUNTIME per bundle, so this positive check lets webpack
  // drop the import from the edge bundle entirely (a negated check would not).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Never touch persisted state while `next build` is collecting page data.
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    await import("./lib/server/manager");
  }
}
