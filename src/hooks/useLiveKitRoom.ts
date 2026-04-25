import { useCallback, useEffect, useRef, useState } from "react";
import { ParticipantKind, Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import type { TranscriptSession, FactCheckFlag } from "@/lib/types";

// Shape of the JSON we publish from the Python agent (see backend/src/agent.py).
// Frontend renders transcripts live; flag verdicts will land here too once Lukas's stream is wired.
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

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
const LIVEKIT_TOKEN = import.meta.env.VITE_LIVEKIT_TOKEN as string | undefined;

// Connect to a LiveKit room, publish the mic, and accumulate every Data Channel
// transcript event into the *current* session block. Each Connect→Disconnect
// cycle gets its own block; older blocks are preserved so the UI can stack them.
export function useLiveKitRoom() {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [flags, setFlags] = useState<FactCheckFlag[]>([]);

  // Establish the underlying LiveKit room connection once and keep it open
  // for the page lifetime. This avoids the dispatch cold-start delay every
  // time the user toggles Connect/Disconnect.
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

    console.log("[livekit] creating room", {
      url: LIVEKIT_URL,
      hasToken: Boolean(LIVEKIT_TOKEN),
    });

    const room = new Room({
      // Auto-tune mic settings for speech use case
      adaptiveStream: true,
      dynacast: true,
    });

    // Decode Data Channel payloads as UTF-8 JSON. The agent publishes JSON
    // on topic "transcript" — later we'll route by `topic` to different UI.
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

        console.log("[livekit data]", { topic, from: participant?.identity, message });

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "transcript" &&
          typeof (message as { text?: unknown }).text === "string"
        ) {
          const transcript = message as { type: "transcript"; text: string; is_final: boolean };
          setSessions((previousSessions) => {
            // Transcripts arriving without a current session means the mic was
            // muted mid-flush — append to the most recent block anyway so
            // Deepgram's trailing final isn't lost.
            if (previousSessions.length === 0) return previousSessions;

            const nextSessions = [...previousSessions];
            const currentSession = { ...nextSessions[nextSessions.length - 1] };

            if (transcript.is_final) {
              // Commit this utterance into the running paragraph and clear the interim slot.
              currentSession.text = currentSession.text
                ? `${currentSession.text} ${transcript.text}`
                : transcript.text;
              currentSession.pendingText = "";
            } else {
              // Interim — overwrite previous interim text for this utterance.
              currentSession.pendingText = transcript.text;
            }

            nextSessions[nextSessions.length - 1] = currentSession;
            console.log("[livekit data] transcript applied", {
              isFinal: transcript.is_final,
              textLength: transcript.text.length,
              sessionId: currentSession.id,
              committedLength: currentSession.text.length,
              pendingLength: currentSession.pendingText.length,
            });
            return nextSessions;
          });        
        }

        // Added: Catch the mock/real fact-check flags using the 'claim' key contract
        // Logical process: Deduplicate based on a combined claim+verdict key so re-published identical flags don't duplicate in the UI.
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "flag" &&
          typeof (message as { claim?: unknown }).claim === "string"
        ) {
          const flagMessage = message as FactCheckFlag;
          setFlags((prev) => {
            const key = `${flagMessage.claim}|${flagMessage.verdict}`;
            if (prev.some((f) => `${f.claim}|${f.verdict}` === key)) return prev;
            return [...prev, flagMessage];
          });
        } else {
          console.log("[livekit data] message ignored (unsupported shape)", {
            topic,
            from: participant?.identity,
            message,
          });
        }
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

    // The room can drop unexpectedly (network blip, server kick). When that
    // happens, clear the ref so the next Connect rebuilds it from scratch.
    room.on(RoomEvent.Disconnected, () => {
      console.log("[livekit] room disconnected");
      roomRef.current = null;
      setStatus("idle");
    });

    await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
    console.log("[livekit] room.connect completed");
    const agentParticipant = Array.from(room.remoteParticipants.values()).find(
      (participant) => participant.kind === ParticipantKind.AGENT,
    );
    if (!agentParticipant) {
      console.warn("[livekit] connected, but no agent participant has joined yet");
    }
    roomRef.current = room;
    console.log("[livekit] room established as", room.localParticipant.identity);
    return room;
  }, []);

  const connect = useCallback(async () => {
    console.log("[livekit] connect requested");
    setStatus("connecting");
    setError(null);

    try {
      const room = await ensureRoomConnected();
      if (!room) {
        console.warn("[livekit] connect aborted: no room available");
        return;
      }
      // Mic on → audio flows to the agent → transcripts arrive on the data channel.
      await room.localParticipant.setMicrophoneEnabled(true);
      console.log("[livekit] microphone enabled");
      // Open a fresh transcript block for this Connect press. Older blocks
      // remain above it so users can review past sessions.
      setSessions((previousSessions) => [
        ...previousSessions,
        {
          id: newSessionId(),
          startedAt: formatTimestamp(new Date()),
          text: "",
          pendingText: "",
        },
      ]);
      setStatus("connected");
      console.log("[livekit] connect flow completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[livekit] connect failed", err);
      setError(msg);
      setStatus("error");
    }
  }, [ensureRoomConnected]);

  // Fully leave the room so the agent's close_on_disconnect fires and the
  // backend's delete_room_on_close=True tears the room down. That lets the
  // next Connect create a fresh room and re-dispatch the agent automatically.
  const disconnect = useCallback(async () => {
    console.log("[livekit] disconnect requested");
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("idle");
  }, []);

  // Cleanup on unmount so HMR / page nav doesn't leak rooms.
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  return { status, error, sessions, flags, connect, disconnect };
}
