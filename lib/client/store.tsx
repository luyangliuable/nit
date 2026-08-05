"use client";

import * as React from "react";
import { toast } from "sonner";
import type {
  SessionSnapshot,
  SessionConfig,
  ServerEvent,
  ChatStreamEvent,
  AuthStatus,
} from "@/lib/shared/types";
import { api } from "./api";

type ChatListener = (event: ChatStreamEvent) => void;
type LogListener = (line: string, pr?: number) => void;
type ReviewStreamListener = (pr: number, event: ChatStreamEvent) => void;

interface StoreValue {
  sessions: SessionSnapshot[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateConfig: (id: string, patch: Partial<SessionConfig>) => void;
  action: (id: string, body: Record<string, unknown>) => Promise<{ ok?: boolean; error?: string }>;
  subscribeChat: (id: string, fn: ChatListener) => () => void;
  subscribeLog: (id: string, fn: LogListener) => () => void;
  subscribeReviewStream: (id: string, fn: ReviewStreamListener) => () => void;
  auth: AuthStatus | null;
  soundEnabled: boolean;
}

const StoreContext = React.createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.frequency.value = 660;
    gain.gain.value = 0.05;
    osc.start();
    setTimeout(() => {
      osc.stop();
      ac.close();
    }, 150);
  } catch {
    // ignore
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = React.useState<SessionSnapshot[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [auth, setAuth] = React.useState<AuthStatus | null>(null);
  const chatListeners = React.useRef(new Map<string, Set<ChatListener>>());
  const logListeners = React.useRef(new Map<string, Set<LogListener>>());
  const reviewStreamListeners = React.useRef(new Map<string, Set<ReviewStreamListener>>());
  const sessionsRef = React.useRef<SessionSnapshot[]>([]);
  sessionsRef.current = sessions;

  const soundEnabled = React.useMemo(
    () => sessions.some((s) => s.config.sound),
    [sessions],
  );

  React.useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    const es = new EventSource("/api/events");
    es.onmessage = (msg) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data) as ServerEvent;
      } catch {
        return;
      }
      handleEvent(event);
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEvent = React.useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "sessions":
        setSessions(event.sessions);
        setActiveId((cur) => cur ?? event.sessions[0]?.config.id ?? null);
        break;
      case "session_update":
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.config.id === event.session.config.id);
          if (idx === -1) return [...prev, event.session];
          const next = [...prev];
          next[idx] = event.session;
          return next;
        });
        setActiveId((cur) => cur ?? event.session.config.id);
        break;
      case "log": {
        const set = logListeners.current.get(event.sessionId);
        if (set) set.forEach((fn) => fn(event.line, event.pr));
        break;
      }
      case "review_stream": {
        const set = reviewStreamListeners.current.get(event.sessionId);
        if (set) set.forEach((fn) => fn(event.pr, event.event));
        break;
      }
      case "auth":
        setAuth(event.status);
        break;
      case "chat": {
        const set = chatListeners.current.get(event.sessionId);
        if (set) set.forEach((fn) => fn(event.event));
        break;
      }
      case "notification": {
        const session = sessionsRef.current.find((s) => s.config.id === event.sessionId);
        toast(event.title, { description: event.body });
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(event.title, { body: event.body });
        }
        if (session?.config.sound) playBeep();
        break;
      }
    }
  }, []);

  const createSession = React.useCallback(async () => {
    const snap = await api.createSession();
    setActiveId(snap.config.id);
  }, []);

  const deleteSession = React.useCallback(async (id: string) => {
    await api.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.config.id !== id));
    setActiveId((cur) => {
      if (cur !== id) return cur;
      const remaining = sessionsRef.current.filter((s) => s.config.id !== id);
      return remaining[0]?.config.id ?? null;
    });
  }, []);

  // Optimistic local config update, persisted to the server. The SSE
  // session_update will reconcile.
  const debounceTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const updateConfig = React.useCallback((id: string, patch: Partial<SessionConfig>) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.config.id === id ? { ...s, config: { ...s.config, ...patch } } : s,
      ),
    );
    const timers = debounceTimers.current;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    timers.set(
      id,
      setTimeout(() => {
        void api.updateSession(id, patch);
      }, 400),
    );
  }, []);

  const action = React.useCallback(
    (id: string, body: Record<string, unknown>) => api.action(id, body),
    [],
  );

  const subscribeChat = React.useCallback((id: string, fn: ChatListener) => {
    let set = chatListeners.current.get(id);
    if (!set) {
      set = new Set();
      chatListeners.current.set(id, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }, []);

  const subscribeLog = React.useCallback((id: string, fn: LogListener) => {
    let set = logListeners.current.get(id);
    if (!set) {
      set = new Set();
      logListeners.current.set(id, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }, []);

  const subscribeReviewStream = React.useCallback((id: string, fn: ReviewStreamListener) => {
    let set = reviewStreamListeners.current.get(id);
    if (!set) {
      set = new Set();
      reviewStreamListeners.current.set(id, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }, []);

  const value: StoreValue = {
    sessions,
    activeId,
    setActiveId,
    createSession,
    deleteSession,
    updateConfig,
    action,
    subscribeChat,
    subscribeLog,
    subscribeReviewStream,
    auth,
    soundEnabled,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
