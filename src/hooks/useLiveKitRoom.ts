import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalAudioTrack,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type TranscriptionSegment,
} from "livekit-client";

// Shape of the JSON we publish from the Python agent (see backend/src/agent.py).
// Frontend renders transcripts live; flag verdicts will land here too once Lukas's stream is wired.
type DataChannelMessage =
  | { type: "transcript"; text: string; is_final: boolean }
  | { type: "flag"; sentence: string; verdict: string; reason: string; source: string }
  | Record<string, unknown>;

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
const LIVEKIT_TOKEN = import.meta.env.VITE_LIVEKIT_TOKEN as string | undefined;

function joinTranscriptText(finalText: string, interimText: string): string {
  return [finalText, interimText].filter(Boolean).join(" ").trim();
}

// Connect to a LiveKit room, publish the mic, and log every Data Channel
// message received from the Python agent. Returns a connect/disconnect API
// plus the live status so the UI can render a button.
export function useLiveKitRoom() {
  const roomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const finalizedTranscriptRef = useRef("");

  const applyTranscript = useCallback((text: string, isFinal: boolean) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    if (isFinal) {
      finalizedTranscriptRef.current = joinTranscriptText(finalizedTranscriptRef.current, trimmedText);
      setTranscriptText(finalizedTranscriptRef.current);
    } else {
      setTranscriptText(joinTranscriptText(finalizedTranscriptRef.current, trimmedText));
    }
  }, []);

  const connect = useCallback(async () => {
    if (!LIVEKIT_URL || !LIVEKIT_TOKEN) {
      const msg = "Missing VITE_LIVEKIT_URL or VITE_LIVEKIT_TOKEN in .env";
      console.error(msg);
      setError(msg);
      setStatus("error");
      return;
    }

    if (roomRef.current) {
      console.log("[livekit] already connected");
      return;
    }

    setStatus("connecting");
    setError(null);
    finalizedTranscriptRef.current = "";
    setTranscriptText("");

    let localAudioTrack: LocalAudioTrack;
    try {
      localAudioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      localAudioTrackRef.current = localAudioTrack;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[livekit] microphone capture failed", err);
      setError(msg);
      setStatus("error");
      return;
    }

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
          applyTranscript(transcript.text, transcript.is_final);
        }
      },
    );

    room.on(
      RoomEvent.TranscriptionReceived,
      (segments: TranscriptionSegment[], participant, publication) => {
        console.log("[livekit transcription]", {
          from: participant?.identity,
          trackSource: publication?.source,
          segments,
        });

        for (const segment of segments) {
          applyTranscript(segment.text, segment.final);
        }
      },
    );

    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      console.log("[livekit] local track published", {
        source: publication.source,
        kind: publication.kind,
        muted: publication.isMuted,
      });
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log("[livekit] participant connected", participant.identity);
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log("[livekit] disconnected");
      localAudioTrackRef.current?.stop();
      localAudioTrackRef.current = null;
      setStatus("idle");
      roomRef.current = null;
    });

    try {
      await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
      // Publish the local mic so the agent has audio to transcribe.
      await room.localParticipant.publishTrack(localAudioTrack, {
        source: Track.Source.Microphone,
        name: "microphone",
      });
      roomRef.current = room;
      setStatus("connected");
      console.log("[livekit] connected as", room.localParticipant.identity);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[livekit] connect failed", err);
      setError(msg);
      setStatus("error");
      localAudioTrack.stop();
      localAudioTrackRef.current = null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    localAudioTrackRef.current?.stop();
    localAudioTrackRef.current = null;
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setStatus("idle");
  }, []);

  // Cleanup on unmount so HMR / page nav doesn't leak rooms.
  useEffect(() => {
    return () => {
      localAudioTrackRef.current?.stop();
      localAudioTrackRef.current = null;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  return { status, error, transcriptText, connect, disconnect };
}
