import { EventEmitter } from "node:events";
import type { ServerEvent } from "@/lib/shared/types";

// A single process wide event bus. API routes subscribe to stream events to the
// browser over SSE; the SessionManager and pollers publish to it.
class EventHub {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: ServerEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

// Persist the hub across Next dev hot reloads via globalThis.
const globalForHub = globalThis as unknown as { __nitHub?: EventHub };
export const hub: EventHub = globalForHub.__nitHub ?? new EventHub();
globalForHub.__nitHub = hub;
