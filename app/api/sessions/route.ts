import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sessions: manager.list() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const snap = manager.create(typeof body.name === "string" ? body.name : undefined);
  return NextResponse.json({ session: snap });
}
