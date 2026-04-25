import { useMemo } from "react";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { StatsHeader } from "@/components/stats/StatsHeader";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { DEMO_SESSION_ID, getMockFactCheckFlags } from "@/lib/mockdata/fact-checks";
import { getMockOpinions } from "@/lib/mockdata/opinions";
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
const MOCK_OPINIONS = getMockOpinions();

const Index = () => {
  // LiveKit connection — browser mic → agent (Deepgram STT) → data channel → these state vars.
  const {
    status: livekitStatus,
    error: livekitError,
    sessions: liveSessions,
    connect,
    disconnect,
  } = useLiveKitRoom();

  // Demo first, live sessions after. The demo block stays so designers /
  // teammates can always see the highlight design even mid-session.
  const sessionsForPanel = useMemo(
    () => [DEMO_SESSION, ...liveSessions],
    [liveSessions],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
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

      <StatsHeader flags={MOCK_FLAGS} opinions={MOCK_OPINIONS} />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <TranscriptPanel
          sessions={sessionsForPanel}
          isLive={livekitStatus === "connected"}
          flags={MOCK_FLAGS}
        />
        <FactCheckSidebar flags={MOCK_FLAGS} />
      </main>
    </div>
  );
};

export default Index;
