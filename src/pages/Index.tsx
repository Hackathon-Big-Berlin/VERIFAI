import { useState } from "react";
import { DebateCoachSidebar } from "@/components/sidepanel/DebateCoachSidebar";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

type AppMode = "analysis" | "debate";

const Index = () => {
  const [mode, setMode] = useState<AppMode>("analysis");

  
  // LiveKit connection — browser mic → agent (Deepgram STT) → data channel → these state vars.
  const {
    status: livekitStatus,
    error: livekitError,
    sessions,
    flags, // Extracting our live backend flags directly from the hook
    debateTurns,
    debateScores,
    debateFinalScore,
    connect,
    disconnect,
  } = useLiveKitRoom(mode);


  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* Floating dev control: connect the browser mic to the LiveKit room. */}
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border bg-card/90 px-3 py-2 text-sm shadow">
        <span className="font-medium">LiveKit:</span>
        <span>{livekitStatus}</span>
        <div className="mx-1 h-4 w-px bg-border" />
        <span className="font-medium">Mode:</span>
        <button
          onClick={() => setMode("analysis")}
          className={`rounded px-2 py-1 ${mode === "analysis" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
        >
          Analysis
        </button>
        <button
          onClick={() => setMode("debate")}
          className={`rounded px-2 py-1 ${mode === "debate" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
        >
          Debate coach
        </button>
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
      <TranscriptPanel sessions={sessions} flags={flags} isLive={livekitStatus === "connected"} />

      {mode === "analysis" ? (
        <FactCheckSidebar flags={flags} />
      ) : (
        <DebateCoachSidebar
          turns={debateTurns}
          scores={debateScores}
          finalScore={debateFinalScore}
        />
      )}
    </main>
  );
};

export default Index;