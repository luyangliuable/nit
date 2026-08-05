import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// Return the persisted session log lines so the console can backfill history
// on open, instead of only showing lines streamed after it mounted.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = manager.get(params.id);
  if (!session) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ lines: session.logTail() });
}
