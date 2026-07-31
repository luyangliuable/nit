import { NextResponse } from "next/server";
import { listAvailableModels } from "@/lib/server/pi";

export const dynamic = "force-dynamic";

// Models that have valid credentials configured for pi, for the picker.
export async function GET() {
  return NextResponse.json({ models: await listAvailableModels() });
}
