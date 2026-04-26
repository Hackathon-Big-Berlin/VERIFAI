import { useCallback, useEffect, useRef, useState } from "react";
import { ParticipantKind, Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import type {
  DebateFinalScore,
  DebateTurn,
  DebateTurnScore,
  FactCheckFlag,
  TranscriptSession,
} from "@/lib/types";

// Shape of the JSON we publish from the Python agent (see backend/src/agent.py).
// Frontend renders transcripts live; flag verdicts will land here too once Lukas's stream is wired.
type DataChannelMessage =
  | { type: "transcript"; text: string; is_final: boolean }
  | { type: "flag"; claim: string; verdict: string; reasoning: string; sources: string[] }
  | {
      type: "debate_turn";
      role: "user" | "model";
      turnId: string;
      text: string;
      timestamp: string;
      sources?: string[];
    }
  | {
      type: "debate_score";
      turnId: string;
      scores: {
        logicalConsistency: number;
        evidenceQuality: number;
        rebuttalEffectiveness: number;
        clarityStructure: number;
        responsiveness: number;
      };
      strongClaims: Array<{ claim: string; strength: "strong"; reason: string }>;
      weakClaims: Array<{ claim: string; strength: "weak"; reason: string }>;
      coachingSuggestion: string;
    }
  | {
      type: "debate_final_score";
      overall: number;
      scores: {
        logicalConsistency: number;
        evidenceQuality: number;
        rebuttalEffectiveness: number;
        clarityStructure: number;
        responsiveness: number;
      };
      summary: string;
    }
  | Record<string, unknown>;

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";
type AppMode = "normal" | "interview" | "debate";

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Match the backend's normalization (agent.py:normalize_claim) so dedup keys
// agree on both ends. Same claim with different trailing punctuation/case is
// treated as one claim; verdict updates replace the existing card.
function normalizeClaim(claim: string): string {
  return claim.toLowerCase().replace(/^[\s.,!?;:'"`-]+|[\s.,!?;:'"`-]+$/g, "");
}

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
const LIVEKIT_TOKEN = import.meta.env.VITE_LIVEKIT_TOKEN as string | undefined;

// Connect to a LiveKit room, publish the mic, and accumulate every Data Channel
// transcript event into the *current* session block. Each Connect→Disconnect
// cycle gets its own block; older blocks are preserved so the UI can stack them.
export function useLiveKitRoom(mode: AppMode = "normal") {
  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const modeRef = useRef<AppMode>(mode);
  // Mirror activeSessionId into a ref so the data-channel callback (created
  // once inside ensureRoomConnected) can tag flags with the current id without
  // re-binding on every connect.
  const activeSessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [flags, setFlags] = useState<FactCheckFlag[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [debateTurns, setDebateTurns] = useState<DebateTurn[]>([]);
  const [debateScores, setDebateScores] = useState<DebateTurnScore[]>([]);
  const [debateFinalScore, setDebateFinalScore] = useState<DebateFinalScore | null>(null);

  const ensureAudioContainer = useCallback((): HTMLDivElement | null => {
    if (typeof document === "undefined") return null;
    if (audioContainerRef.current) return audioContainerRef.current;

    const container = document.createElement("div");
    container.id = "livekit-remote-audio";
    container.setAttribute("aria-hidden", "true");
    container.style.position = "fixed";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
    audioContainerRef.current = container;
    return container;
  }, []);

  const cleanupRemoteAudio = useCallback(() => {
    audioElementsRef.current.forEach((element) => {
      try {
        element.pause();
      } catch {
        // no-op
      }
      if (element.parentElement) element.parentElement.removeChild(element);
    });
    audioElementsRef.current.clear();

    if (audioContainerRef.current?.parentElement) {
      audioContainerRef.current.parentElement.removeChild(audioContainerRef.current);
    }
    audioContainerRef.current = null;
  }, []);

  const publishAppMode = useCallback(async (nextMode: AppMode) => {
    const room = roomRef.current;
    if (!room) return;

    const payload = new TextEncoder().encode(
      JSON.stringify({ type: "app_mode", mode: nextMode }),
    );

    try {
      await room.localParticipant.publishData(payload, {
        reliable: true,
        topic: "control",
      });
      console.log("[livekit control] app mode published", nextMode);
    } catch (err) {
      console.warn("[livekit control] failed to publish app mode", err);
    }
  }, []);

  useEffect(() => {
    modeRef.current = mode;
    if (mode === "debate") {
      setFlags([]);
    }
  }, [mode]);

  const clearDebate = useCallback(() => {
    setDebateTurns([]);
    setDebateScores([]);
    setDebateFinalScore(null);
  }, []);

  useEffect(() => {
    void publishAppMode(mode);
  }, [mode, publishAppMode]);

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
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "flag" &&
          typeof (message as { claim?: unknown }).claim === "string"
        ) {
          if (modeRef.current === "debate") return;
          const flagMessage = {
            ...(message as Record<string, unknown>),
            sessionId: activeSessionIdRef.current ?? "unknown_session",
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
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "debate_turn" &&
          typeof (message as { turnId?: unknown }).turnId === "string" &&
          typeof (message as { text?: unknown }).text === "string"
        ) {
          if (modeRef.current !== "debate") return;
          const debateTurn = message as {
            type: "debate_turn";
            role: "user" | "model";
            turnId: string;
            text: string;
            timestamp: string;
            sources?: string[];
          };
          setDebateTurns((prev) => {
            if (prev.some((turn) => turn.id === debateTurn.turnId)) return prev;
            return [
              ...prev,
              {
                id: debateTurn.turnId,
                role: debateTurn.role,
                text: debateTurn.text,
                timestamp: debateTurn.timestamp,
                sources: Array.isArray(debateTurn.sources)
                  ? debateTurn.sources.filter((url): url is string => typeof url === "string")
                  : [],
              },
            ];
          });
          
          // When a user turn is committed, create a fresh session so the next
          // draft starts empty and accumulates fresh transcripts.
          if (debateTurn.role === "user") {
            const nextId = newSessionId();
            activeSessionIdRef.current = nextId;
            setActiveSessionId(nextId);
            setSessions((previousSessions) => [
              ...previousSessions,
              {
                id: nextId,
                startedAt: formatTimestamp(new Date()),
                text: "",
                pendingText: "",
              },
            ]);
          }
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "debate_score" &&
          typeof (message as { turnId?: unknown }).turnId === "string"
        ) {
          if (modeRef.current !== "debate") return;
          const scoreUpdate = message as DebateTurnScore & { type: "debate_score" };
          setDebateScores((prev) => {
            const idx = prev.findIndex((item) => item.turnId === scoreUpdate.turnId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = scoreUpdate;
              return next;
            }
            return [...prev, scoreUpdate];
          });
          return;
        }

        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "debate_final_score" &&
          typeof (message as { overall?: unknown }).overall === "number"
        ) {
          if (modeRef.current !== "debate") return;
          setDebateFinalScore(message as DebateFinalScore);
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

      if (participant.kind === ParticipantKind.AGENT) {
        // Ensure backend receives the current mode even if the first control
        // publish happened before the agent participant was fully active.
        void publishAppMode(modeRef.current);
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log("[livekit] remote track subscribed", {
        identity: participant.identity,
        kind: participant.kind,
        source: publication.source,
        trackKind: track.kind,
      });

      if (track.kind !== "audio") return;

      const container = ensureAudioContainer();
      if (!container) return;

      const key = publication.trackSid;
      if (audioElementsRef.current.has(key)) return;

      const mediaElement = track.attach();
      mediaElement.autoplay = true;
      mediaElement.playsInline = true;
      container.appendChild(mediaElement);
      audioElementsRef.current.set(key, mediaElement);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (track.kind !== "audio") return;

      const key = publication.trackSid;
      const existing = audioElementsRef.current.get(key);
      if (!existing) return;

      track.detach(existing);
      if (existing.parentElement) existing.parentElement.removeChild(existing);
      audioElementsRef.current.delete(key);
    });

    // The room can drop unexpectedly (network blip, server kick). When that
    // happens, clear the ref so the next Connect rebuilds it from scratch.
    room.on(RoomEvent.Disconnected, () => {
      console.log("[livekit] room disconnected");
      roomRef.current = null;
      cleanupRemoteAudio();
      setStatus("idle");
    });

    await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
    console.log("[livekit] room.connect completed");
    const agentParticipant = Array.from(room.remoteParticipants.values()).find(
      (participant) => participant.kind === ParticipantKind.AGENT,
    );
    if (!agentParticipant) {
      console.warn("[livekit] connected, but no agent participant has joined yet");
    } else {
      void publishAppMode(modeRef.current);
    }
    roomRef.current = room;
    console.log("[livekit] room established as", room.localParticipant.identity);
    return room;
  }, [cleanupRemoteAudio, ensureAudioContainer, publishAppMode]);

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
      const nextId = newSessionId();
      activeSessionIdRef.current = nextId;
      setActiveSessionId(nextId);
      setSessions((previousSessions) => [
        ...previousSessions,
        {
          id: nextId,
          startedAt: formatTimestamp(new Date()),
          text: "",
          pendingText: "",
        },
      ]);
      await publishAppMode(modeRef.current);
      setStatus("connected");
      console.log("[livekit] connect flow completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[livekit] connect failed", err);
      setError(msg);
      setStatus("error");
    }
  }, [ensureRoomConnected, publishAppMode]);

  // Fully leave the room so the agent's close_on_disconnect fires and the
  // backend's delete_room_on_close=True tears the room down. That lets the
  // next Connect create a fresh room and re-dispatch the agent automatically.
  const disconnect = useCallback(async () => {
    console.log("[livekit] disconnect requested");
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("idle");
  }, []);

  const muteMicrophone = useCallback(async () => {
    if (!roomRef.current) return;
    await roomRef.current.localParticipant.setMicrophoneEnabled(false);
    console.log("[livekit] microphone disabled");
  }, []);

  const unmuteMicrophone = useCallback(async () => {
    if (!roomRef.current) return;
    await roomRef.current.localParticipant.setMicrophoneEnabled(true);
    console.log("[livekit] microphone enabled");
  }, []);

  // Cleanup on unmount so HMR / page nav doesn't leak rooms.
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
      cleanupRemoteAudio();
    };
  }, [cleanupRemoteAudio]);

  return {
    status,
    error,
    sessions,
    flags,
    activeSessionId,
    debateTurns,
    debateScores,
    debateFinalScore,
    clearDebate,
    connect,
    disconnect,
    muteMicrophone,
    unmuteMicrophone,
  };
}
