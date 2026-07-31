import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// GET returns the current chat history and available slash commands. POST sends
// a prompt (fire and forget; responses stream over SSE) or aborts.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const chat = manager.chat(params.id);
  if (!chat) return NextResponse.json({ error: "not-found" }, { status: 404 });
  await chat.ensure();
  return NextResponse.json({ history: chat.history(), commands: chat.getSlashCommands() });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const chat = manager.chat(params.id);
  if (!chat) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "abort") {
    await chat.abort();
    return NextResponse.json({ ok: true });
  }
  const text: string = body.text ?? "";
  if (text.trim() === "") return NextResponse.json({ error: "empty" }, { status: 400 });
  void chat.prompt(text);
  return NextResponse.json({ ok: true });
}
