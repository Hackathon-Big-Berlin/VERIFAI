import { useCallback, useEffect, useRef, useState } from "react";
import { 
  ParticipantKind, 
  Room, 
  RoomEvent, 
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant 
} from "livekit-client";
import type { TranscriptSession, FactCheckFlag } from "@/lib/types";

type DataChannelMessage =
  | { type: "transcript"; text: string; is_final: boolean }
  | { type: "flag"; claim: string; verdict: string; reasoning: string; sources: string[] }
  | Record<string, unknown>;

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeClaim(claim: string): string {
  return claim.toLowerCase().replace(/^[\s.,!?;:'"`-]+|[\s.,!?;:'"`-]+$/g, "");
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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // New Interview Mode State
  const [interviewMode, setInterviewMode] = useState<boolean>(false);
  const interviewModeRef = useRef<boolean>(false);
  const audioElementsRef = useRef<HTMLAudioElement[]>([]);

  const toggleInterviewMode = useCallback(() => {
    setInterviewMode((prev) => {
      const next = !prev;
      interviewModeRef.current = next;
      // Instantly mute or unmute existing DOM audio elements
      audioElementsRef.current.forEach((el) => {
        el.muted = !next;
      });
      return next;
    });
  }, []);

  const ensureRoomConnected = useCallback(async (): Promise<Room | null> => {
    if (roomRef.current) {
      return roomRef.current;
    }

    if (!LIVEKIT_URL || !LIVEKIT_TOKEN) {
      const msg = "Missing VITE_LIVEKIT_URL or VITE_LIVEKIT_TOKEN in .env";
      setError(msg);
      setStatus("error");
      return null;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    const decoder = new TextDecoder();
    room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, participant?: RemoteParticipant, _kind?, topic?: string) => {
        let message: DataChannelMessage;
        try {
          message = JSON.parse(decoder.decode(payload)) as DataChannelMessage;
        } catch (err) {
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
              if (prev[idx].verdict === flagMessage.verdict) return prev;
              const next = [...prev];
              next[idx] = flagMessage;
              return next;
            }
            return [...prev, flagMessage];
          });
        }
      },
    );

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach() as HTMLAudioElement;
          element.muted = !interviewModeRef.current; // sync with current state
          audioElementsRef.current.push(element);
          document.body.appendChild(element);
        } else if (track.kind === Track.Kind.Video) {
          const element = track.attach();
          document.body.appendChild(element);
        }
      }
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        const elements = track.detach();
        elements.forEach((el) => {
          if (el instanceof HTMLAudioElement) {
            audioElementsRef.current = audioElementsRef.current.filter(a => a !== el);
          }
          el.remove();
        });
      }
    );

    room.on(RoomEvent.Disconnected, () => {
      roomRef.current = null;
      setStatus("idle");
    });

    await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
    roomRef.current = room;
    return room;
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);

    try {
      const room = await ensureRoomConnected();
      if (!room) return;
      
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

  const disconnect = useCallback(async () => {
    try {
      await roomRef.current?.disconnect();
    } catch (err) {
      console.error("[livekit] error disconnecting", err);
    }
    roomRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  return { status, error, sessions, flags, activeSessionId, connect, disconnect, interviewMode, toggleInterviewMode };
}