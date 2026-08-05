import { NextRequest, NextResponse } from "next/server";
import { credentials } from "@/lib/server/credentials";
import { getOctokit, resetOctokit, githubAuthStatus } from "@/lib/server/octokit";
import { hub } from "@/lib/server/events";

export const dynamic = "force-dynamic";

// Recompute status, broadcast it so every client and the review gate update,
// and return it. Also reports whether a token is stored in-app (never the token).
async function broadcastStatus() {
  const status = await githubAuthStatus(true);
  hub.publish({ type: "auth", status });
  const stored = await credentials.getGithubToken();
  return { status, hasStoredToken: Boolean(stored) };
}

export async function GET() {
  return NextResponse.json(await broadcastStatus());
}

// Save an in-app GitHub token. Validates it before persisting so a bad token is
// rejected instead of silently breaking reviews.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token: string = (body.token ?? "").trim();
  if (!token) return NextResponse.json({ error: "empty-token" }, { status: 400 });

  const previous = await credentials.getGithubToken();
  await credentials.setGithubToken(token);
  resetOctokit();
  try {
    const o = await getOctokit();
    await o.rest.users.getAuthenticated();
  } catch (err) {
    // Roll back to the previous token so a rejected one does not lock the user out.
    await credentials.setGithubToken(previous);
    resetOctokit();
    await broadcastStatus();
    return NextResponse.json({ error: `Token rejected: ${String((err as Error).message ?? err)}` }, { status: 400 });
  }
  return NextResponse.json(await broadcastStatus());
}

// Clear the stored token; auth falls back to env / gh CLI if present.
export async function DELETE() {
  await credentials.setGithubToken(undefined);
  resetOctokit();
  return NextResponse.json(await broadcastStatus());
}
