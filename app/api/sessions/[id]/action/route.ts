import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// Consolidated control endpoint for a session: poller lifecycle, approval queue
// actions and per comment edits. Body: { action, ... }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = manager.get(params.id);
  if (!session) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action: string = body.action;

  switch (action) {
    case "start":
      manager.start(params.id);
      return NextResponse.json({ ok: true });
    case "stop":
      manager.stop(params.id);
      return NextResponse.json({ ok: true });
    case "poll_now":
      void session.pollCycle();
      return NextResponse.json({ ok: true });
    case "mark_read":
      session.markRead();
      return NextResponse.json({ ok: true });
    case "approve":
      return NextResponse.json(await session.approve(body.key));
    case "post_suggestions":
      return NextResponse.json(await session.postSuggestionsAction(body.key));
    case "dismiss":
      await session.dismiss(body.key);
      return NextResponse.json({ ok: true });
    case "re_review":
      // Fire and forget: the review runs async and streams updates over SSE.
      void session.reReview(body.key, body.overrides);
      return NextResponse.json({ ok: true });
    case "regenerate_visualization":
      // Fire and forget: generation streams updates over SSE.
      return NextResponse.json(await session.regenerateVisualization(body.key));
    case "stop_review":
      session.stopReview(body.key);
      return NextResponse.json({ ok: true });
    case "keep_comment":
      session.keepComment(body.key, body.commentId, body.keep !== false);
      return NextResponse.json({ ok: true });
    case "edit_comment":
      session.editComment(body.key, body.commentId, body.body ?? "");
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "unknown-action" }, { status: 400 });
  }
}
