import { NextRequest, NextResponse } from "next/server";
import { credentials } from "@/lib/server/credentials";
import { getOctokit, resetOctokit, githubAuthStatus } from "@/lib/server/octokit";
import { hub } from "@/lib/server/events";

export const dynamic = "force-dynamic";

/** Return GitHub credential status without exposing the stored token. */
async function broadcastStatus() {
  const status = await githubAuthStatus(true);
  hub.publish({ type: "auth", status });
  const stored = await credentials.getGithubToken();
  const username = await credentials.getGithubUsername();
  return { status, hasStoredToken: Boolean(stored), username };
}

export async function GET() {
  return NextResponse.json(await broadcastStatus());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token: string = (body.token ?? "").trim();
  const username: string = (body.username ?? "").trim();
  if (!token) return NextResponse.json({ error: "empty-token" }, { status: 400 });
  if (username && !/^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/.test(username)) {
    return NextResponse.json({ error: "invalid-username" }, { status: 400 });
  }

  const previousToken = await credentials.getGithubToken();
  const previousUsername = await credentials.getGithubUsername();
  await credentials.setGithub(token, username);
  resetOctokit();
  try {
    const o = await getOctokit();
    const account = await o.rest.users.getAuthenticated();
    if (username && account.data.login.toLowerCase() !== username.toLowerCase()) {
      throw new Error(`Username does not match the token account (${account.data.login}).`);
    }
  } catch (err) {
    await credentials.setGithub(previousToken, previousUsername);
    resetOctokit();
    await broadcastStatus();
    return NextResponse.json({ error: `Token rejected: ${String((err as Error).message ?? err)}` }, { status: 400 });
  }
  return NextResponse.json(await broadcastStatus());
}

export async function DELETE() {
  await credentials.setGithub(undefined, undefined);
  resetOctokit();
  return NextResponse.json(await broadcastStatus());
}
