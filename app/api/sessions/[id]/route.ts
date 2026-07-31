import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = manager.get(params.id);
  if (!session) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ session: session.snapshot(), logs: session.logTail() });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const patch = await req.json().catch(() => ({}));
  const snap = manager.update(params.id, patch);
  if (!snap) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ session: snap });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await manager.remove(params.id);
  return NextResponse.json({ ok: true });
}
