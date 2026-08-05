import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// Return the buffered review transcript (thinking, response, tool calls) for a
// PR so the console can replay it when the PR is re-selected. Live updates
// arrive over SSE as review_stream events.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = manager.get(params.id);
  if (!session) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const pr = Number(req.nextUrl.searchParams.get("pr"));
  if (!Number.isFinite(pr)) return NextResponse.json({ blocks: [] });
  return NextResponse.json({ blocks: await session.reviewTranscript(pr) });
}
