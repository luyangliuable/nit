import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// Serve the saved change visualization for a PR as structured JSON. The client
// renders it with the app theme, so it always follows light/dark mode.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = manager.get(params.id);
  if (!session) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const pr = Number(req.nextUrl.searchParams.get("pr"));
  const sha = req.nextUrl.searchParams.get("sha") ?? "";
  const visualization = session.readVisualization(pr, sha);
  if (visualization === null) return NextResponse.json({ error: "no-visualization" }, { status: 404 });
  return NextResponse.json({ visualization });
}
