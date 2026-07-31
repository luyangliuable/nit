import { NextRequest } from "next/server";
import { hub } from "@/lib/server/events";
import { manager } from "@/lib/server/manager";

export const dynamic = "force-dynamic";

// Server sent events stream. Emits an initial full snapshot, then every server
// event as it happens (session updates, logs, notifications, chat deltas).
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed
        }
      };

      send({ type: "sessions", sessions: manager.list() });
      unsubscribe = hub.subscribe(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // ignore
        }
      }, 25000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
