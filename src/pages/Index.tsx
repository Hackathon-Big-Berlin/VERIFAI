import { useMemo } from "react";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { DEMO_SESSION_ID, getMockFactCheckFlags } from "@/lib/mockdata/fact-checks";
import { getMockTranscriptLines } from "@/lib/mockdata/transcript";
import type { TranscriptSession } from "@/lib/types";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

// Demo session pre-populated with a mock transcript so the highlighting
// design is visible the moment the page loads — even without the agent
// running. Real sessions append below it once the user clicks Connect.
const DEMO_SESSION: TranscriptSession = {
  id: DEMO_SESSION_ID,
  startedAt: "demo",
  text: getMockTranscriptLines()
    .map((line) => line.text)
    .join(" "),
  pendingText: "",
};

const MOCK_FLAGS = getMockFactCheckFlags();

const Index = () => {
  // LiveKit connection — browser mic → agent (Deepgram STT) → data channel → these state vars.
  const {
    status: livekitStatus,
    error: livekitError,
    sessions: liveSessions,
    connect,
    disconnect,
  } = useLiveKitRoom();

  useEffect(() => {
    console.log("[ui] livekit state", {
      status: livekitStatus,
      error: livekitError,
      sessions: sessions.length,
    });
  }, [livekitStatus, livekitError, sessions.length]);

  useEffect(() => {
    const latestSession = sessions[sessions.length - 1];
    if (!latestSession) return;
    console.log("[ui] latest transcript session", {
      id: latestSession.id,
      startedAt: latestSession.startedAt,
      committedLength: latestSession.text.length,
      pendingLength: latestSession.pendingText.length,
    });
  }, [sessions]);

  // Temporary: drip-feed mock fact-check flags so the sidebar isn't empty during dev.
  // Remove this once Lukas's `flag` payloads start arriving on the data channel.
  useEffect(() => {
    let currentIndex = 0;
    const intervalId = window.setInterval(() => {
      const nextFlag = factCheckFlags[currentIndex];
      if (!nextFlag) {
        window.clearInterval(intervalId);
        return;
      }
      setVisibleFlags((currentFlags) => [...currentFlags, nextFlag]);
      currentIndex += 1;
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* Floating dev control: connect the browser mic to the LiveKit room. */}
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border bg-card/90 px-3 py-2 text-sm shadow">
        <span className="font-medium">LiveKit:</span>
        <span>{livekitStatus}</span>
        {livekitStatus === "idle" || livekitStatus === "error" ? (
          <button
            onClick={connect}
            className="rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="rounded bg-destructive px-2 py-1 text-destructive-foreground hover:opacity-90"
            disabled={livekitStatus === "connecting"}
          >
            Disconnect
          </button>
        )}
        {livekitError ? <span className="text-destructive">{livekitError}</span> : null}
      </div>
      <TranscriptPanel
        sessions={sessionsForPanel}
        isLive={livekitStatus === "connected"}
        flags={MOCK_FLAGS}
      />
      <FactCheckSidebar flags={MOCK_FLAGS} />
    </main>
  );
};

export default Index;
