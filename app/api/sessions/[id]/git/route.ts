import { NextRequest, NextResponse } from "next/server";
import { manager } from "@/lib/server/manager";
import * as git from "@/lib/server/git";

export const dynamic = "force-dynamic";

function cwdFor(id: string): string | null {
  const session = manager.get(id);
  if (!session) return null;
  const p = session.config.localPath;
  return p && p.trim() !== "" ? p : null;
}

// GET returns branch and status overview. POST performs a git operation.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const cwd = cwdFor(params.id);
  if (!cwd) return NextResponse.json({ error: "no-local-path" }, { status: 400 });
  if (!(await git.isGitRepo(cwd))) {
    return NextResponse.json({ error: "not-a-git-repo" }, { status: 400 });
  }
  const [branch, branches, status] = await Promise.all([
    git.currentBranch(cwd),
    git.listBranches(cwd),
    git.status(cwd),
  ]);
  return NextResponse.json({ branch, branches, status });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const cwd = cwdFor(params.id);
  if (!cwd) return NextResponse.json({ error: "no-local-path" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  switch (body.op) {
    case "diff":
      return NextResponse.json({ diff: await git.diff(cwd, !!body.staged) });
    case "checkout":
      return NextResponse.json(await git.checkout(cwd, body.branch));
    case "create_branch":
      return NextResponse.json(await git.createBranch(cwd, body.branch));
    case "stage_all":
      return NextResponse.json(await git.stageAll(cwd));
    case "commit":
      return NextResponse.json(await git.commit(cwd, body.message ?? ""));
    case "push":
      return NextResponse.json(await git.push(cwd));
    case "open_pr":
      return NextResponse.json(await git.openPr(cwd, body.title ?? "", body.body ?? ""));
    default:
      return NextResponse.json({ error: "unknown-op" }, { status: 400 });
  }
}
