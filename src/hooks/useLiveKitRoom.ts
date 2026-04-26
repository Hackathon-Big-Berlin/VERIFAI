import { useCallback, useEffect, useRef, useState } from "react";
import { ParticipantKind, Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import type { TranscriptSession, FactCheckFlag } from "@/lib/types";

// Shape of the JSON we publish from / receive on the LiveKit data channel.
type DataChannelMessage =
  | { type: "transcript"; text: string; is_final: boolean }
  | {
      type: "flag";
      claim: string;
      verdict: string;
      reasoning: string;
      sources: string[];
      used_trusted_context?: boolean;
    }
  | {
      type: "context_status";
      phase: "loading" | "vetting" | "ready" | "error";
      kept?: number;
      total?: number;
      error?: string;
    }
  | Record<string, unknown>;

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export type ContextMode = "gospel" | "nuanced";

// `ContextStatus` is a discriminated union so each phase can carry its own
// shape of data without optional fields everywhere downstream.
export type ContextStatus =
  | { phase: "none" }
  | { phase: "staged"; mode: ContextMode; statements: string[]; fileName: string }
  | { phase: "loading"; mode: ContextMode; total: number; fileName: string }
  | {
      phase: "vetting";
      mode: ContextMode;
      kept: number;
      total: number;
      fileName: string;
    }
  | {
      phase: "ready";
      mode: ContextMode;
      kept: number;
      total: number;
      fileName: string;
    }
  | { phase: "error"; error: string };

const MAX_CONTEXT_FILE_BYTES = 32 * 1024;
const AGENT_WAIT_TIMEOUT_MS = 8000;

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Match backend/src/agent.py:normalize_claim so dedup keys agree on both ends.
function normalizeClaim(claim: string): string {
  return claim.toLowerCase().replace(/^[\s.,!?;:'"`-]+|[\s.,!?;:'"`-]+$/g, "");
}

// Mirrors backend/src/context_loader.py:parse_context_text — one statement per
// line, "#" lines and blanks are dropped.
function parseStatements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
const LIVEKIT_TOKEN = import.meta.env.VITE_LIVEKIT_TOKEN as string | undefined;

export function useLiveKitRoom() {
  const roomRef = useRef<Room | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [flags, setFlags] = useState<FactCheckFlag[]>([]);
  const [contextStatus, setContextStatus] = useState<ContextStatus>({ phase: "none" });

  // The connect flow needs the latest contextStatus snapshot but doesn't want
  // to re-create on every change. Mirror it into a ref so callbacks can read
  // current state without becoming a dependency.
  const contextStatusRef = useRef(contextStatus);
  useEffect(() => {
    contextStatusRef.current = contextStatus;
  }, [contextStatus]);

  const ensureRoomConnected = useCallback(async (): Promise<Room | null> => {
    if (roomRef.current) {
      console.log("[livekit] reusing existing room instance");
      return roomRef.current;
    }

    if (!LIVEKIT_URL || !LIVEKIT_TOKEN) {
      const msg = "Missing VITE_LIVEKIT_URL or VITE_LIVEKIT_TOKEN in .env";
      console.error(msg);
      setError(msg);
      setStatus("error");
      return null;
    }

    console.log("[livekit] creating room", { url: LIVEKIT_URL, hasToken: Boolean(LIVEKIT_TOKEN) });

    const room = new Room({ adaptiveStream: true, dynacast: true });

    const decoder = new TextDecoder();
    room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, participant?: RemoteParticipant, _kind?, topic?: string) => {
        let message: DataChannelMessage;
        try {
          message = JSON.parse(decoder.decode(payload)) as DataChannelMessage;
        } catch (err) {
          console.warn("[livekit data] non-JSON payload", err);
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "transcript" &&
          typeof (message as { text?: unknown }).text === "string"
        ) {
          const transcript = message as { type: "transcript"; text: string; is_final: boolean };
          setSessions((previousSessions) => {
            if (previousSessions.length === 0) return previousSessions;

            const nextSessions = [...previousSessions];
            const currentSession = { ...nextSessions[nextSessions.length - 1] };

            if (transcript.is_final) {
              currentSession.text = currentSession.text
                ? `${currentSession.text} ${transcript.text}`
                : transcript.text;
              currentSession.pendingText = "";
            } else {
              currentSession.pendingText = transcript.text;
            }

            nextSessions[nextSessions.length - 1] = currentSession;
            return nextSessions;
          });
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "flag" &&
          typeof (message as { claim?: unknown }).claim === "string"
        ) {
          const flagMessage = {
            ...message,
            sessionId: activeSessionIdRef.current || "unknown_session"
          } as FactCheckFlag;

          setFlags((prev) => {
            const incoming = normalizeClaim(flagMessage.claim);
            const idx = prev.findIndex((f) => normalizeClaim(f.claim) === incoming);
            if (idx >= 0) {
              if (
                prev[idx].verdict === flagMessage.verdict &&
                prev[idx].used_trusted_context === flagMessage.used_trusted_context
              ) {
                return prev;
              }
              const next = [...prev];
              next[idx] = flagMessage;
              return next;
            }
            return [...prev, flagMessage];
          });
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "context_status"
        ) {
          const m = message as {
            type: "context_status";
            phase: "loading" | "vetting" | "ready" | "error";
            kept?: number;
            total?: number;
            error?: string;
          };
          setContextStatus((prev) => {
            if (prev.phase === "none" || prev.phase === "error") return prev;
            // We carry mode + fileName forward across status updates.
            const carry =
              prev.phase === "staged" || prev.phase === "loading" || prev.phase === "vetting" || prev.phase === "ready"
                ? { mode: prev.mode, fileName: prev.fileName }
                : null;
            if (!carry) return prev;

            if (m.phase === "error") {
              return { phase: "error", error: m.error ?? "Context upload failed." };
            }
            if (m.phase === "ready") {
              return {
                phase: "ready",
                mode: carry.mode,
                fileName: carry.fileName,
                kept: m.kept ?? 0,
                total: m.total ?? 0,
              };
            }
            if (m.phase === "vetting") {
              return {
                phase: "vetting",
                mode: carry.mode,
                fileName: carry.fileName,
                kept: m.kept ?? 0,
                total: m.total ?? 0,
              };
            }
            // loading
            return {
              phase: "loading",
              mode: carry.mode,
              fileName: carry.fileName,
              total: m.total ?? 0,
            };
          });
          return;
        }

        console.log("[livekit data] message ignored (unsupported shape)", {
          topic,
          from: participant?.identity,
          message,
        });
      },
    );

    room.on(RoomEvent.ConnectionStateChanged, (connectionState) => {
      console.log("[livekit] connection state", connectionState);
    });

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.log("[livekit] participant connected", {
        identity: participant.identity,
        kind: participant.kind,
      });
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log("[livekit] remote track subscribed", {
        identity: participant.identity,
        kind: participant.kind,
        source: publication.source,
        trackKind: track.kind,
      });
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log("[livekit] room disconnected");
      roomRef.current = null;
      setStatus("idle");
      // Intentionally NOT clearing activeSessionId here so the meter persists
    });

    await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
    console.log("[livekit] room.connect completed");
    roomRef.current = room;
    return room;
  }, []);

  // Stage a context file before Connect. Parses + size-checks client-side; the
  // staged payload is sent on the data channel right after the agent joins.
  const stageContext = useCallback(async (file: File, mode: ContextMode) => {
    if (file.size > MAX_CONTEXT_FILE_BYTES) {
      setContextStatus({
        phase: "error",
        error: `File exceeds ${MAX_CONTEXT_FILE_BYTES / 1024}KB limit (got ${Math.round(file.size / 1024)}KB).`,
      });
      return;
    }
    const text = await file.text();
    const statements = parseStatements(text);
    if (statements.length === 0) {
      setContextStatus({
        phase: "error",
        error: "File has no usable statements (one statement per line, # for comments).",
      });
      return;
    }
    setContextStatus({ phase: "staged", mode, statements, fileName: file.name });
  }, []);

  const clearContext = useCallback(() => setContextStatus({ phase: "none" }), []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    try {
      const room = await ensureRoomConnected();
      if (!room) return;

      // Open a fresh transcript block for this Connect press.
      setSessions((prev) => [
        ...prev,
        { id: newSessionId(), startedAt: formatTimestamp(new Date()), text: "", pendingText: "" },
      ]);

      const staged = contextStatusRef.current;
      if (staged.phase === "staged") {
        // Wait for the agent participant before publishing — data sent before
        // the agent joins goes into the void (no recipient).
        const agent = await waitForAgent(room, AGENT_WAIT_TIMEOUT_MS);
        if (!agent) {
          setContextStatus({ phase: "error", error: "Agent did not join in time. Try Connect again." });
          // Continue to enable mic; user can still operate without context.
        } else {
          const payload = {
            type: "context",
            mode: staged.mode,
            statements: staged.statements,
          };
          const encoder = new TextEncoder();
          await room.localParticipant.publishData(encoder.encode(JSON.stringify(payload)), {
            reliable: true,
            topic: "context",
          });
          setContextStatus({
            phase: "loading",
            mode: staged.mode,
            total: staged.statements.length,
            fileName: staged.fileName,
          });
          console.log("[livekit] context payload sent", {
            mode: staged.mode,
            count: staged.statements.length,
          });

          // Mic stays off until vetting reports "ready". For gospel mode
          // this is near-instant; for nuanced it can take seconds.
          setStatus("connected");
          return;
        }
      }

      await room.localParticipant.setMicrophoneEnabled(true);
      
      const newId = newSessionId();
      activeSessionIdRef.current = newId;
      setActiveSessionId(newId);

      setSessions((previousSessions) => [
        ...previousSessions,
        {
          id: newId,
          startedAt: formatTimestamp(new Date()),
          text: "",
          pendingText: "",
        },
      ]);
      setStatus("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
    }
  }, [ensureRoomConnected]);

  // Once context is fully ready, enable the mic. For sessions without an
  // upload, the mic is already enabled inside `connect`, so this is a no-op.
  useEffect(() => {
    if (contextStatus.phase !== "ready") return;
    const room = roomRef.current;
    if (!room) return;
    if (room.localParticipant.isMicrophoneEnabled) return;
    void room.localParticipant.setMicrophoneEnabled(true).then(() => {
      console.log("[livekit] microphone enabled (post-context-ready)");
    });
  }, [contextStatus]);

  const disconnect = useCallback(async () => {
    try {
      await roomRef.current?.disconnect();
    } catch (err) {
      console.error("[livekit] error disconnecting", err);
    }
    roomRef.current = null;
    setStatus("idle");
    // Clearing flags + sessions is intentionally NOT done here — the user can
    // review them after disconnect. Context status is reset since it's tied
    // to the agent session.
    setContextStatus({ phase: "none" });
  }, []);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  return {
    status,
    error,
    sessions,
    flags,
    connect,
    disconnect,
    contextStatus,
    stageContext,
    clearContext,
  };
}

// Resolve when an agent participant joins the room (or null after timeout).
async function waitForAgent(room: Room, timeoutMs: number): Promise<RemoteParticipant | null> {
  const existing = Array.from(room.remoteParticipants.values()).find(
    (p) => p.kind === ParticipantKind.AGENT,
  );
  if (existing) return existing;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, handler);
      resolve(null);
    }, timeoutMs);

    const handler = (participant: RemoteParticipant) => {
      if (participant.kind === ParticipantKind.AGENT) {
        clearTimeout(timer);
        room.off(RoomEvent.ParticipantConnected, handler);
        resolve(participant);
      }
    };

    room.on(RoomEvent.ParticipantConnected, handler);
  });
}