import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// Serve the saved HTML visualization for a PR. Returned as text/html so it can
// be loaded directly into a sandboxed iframe via srcdoc on the client.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = manager.get(params.id);
  if (!session) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const pr = Number(req.nextUrl.searchParams.get("pr"));
  const sha = req.nextUrl.searchParams.get("sha") ?? "";
  const html = session.readVisualization(pr, sha);
  if (html === null) return NextResponse.json({ error: "no-visualization" }, { status: 404 });
  return NextResponse.json({ html });
}
