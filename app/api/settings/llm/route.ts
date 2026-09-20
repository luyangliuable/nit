import { NextRequest, NextResponse } from "next/server";
import { credentials } from "@/lib/server/credentials";
import { resetPiConfig } from "@/lib/server/pi";

export const dynamic = "force-dynamic";

/** Return LLM override metadata without exposing the API key. */
async function status() {
  const override = await credentials.getLlmOverride();
  return { endpoint: override?.endpoint ?? "", hasApiKey: Boolean(override?.apiKey) };
}

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json(await status());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const endpoint: string = (body.endpoint ?? "").trim().replace(/\/$/, "");
  const apiKey: string = (body.apiKey ?? "").trim();
  if (!validEndpoint(endpoint)) return NextResponse.json({ error: "invalid-endpoint" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "empty-api-key" }, { status: 400 });

  await credentials.setLlmOverride({ endpoint, apiKey });
  resetPiConfig();
  return NextResponse.json(await status());
}

export async function DELETE() {
  await credentials.setLlmOverride(undefined);
  resetPiConfig();
  return NextResponse.json(await status());
}
