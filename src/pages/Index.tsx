import { useState } from "react";
import { DebateChatPanel } from "@/components/debate/DebateChatPanel";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

type AppMode = "analysis" | "debate";
type DebateStage = "active" | "stopped";

const Index = () => {
  const [mode, setMode] = useState<AppMode>("analysis");
  const [debateStage, setDebateStage] = useState<DebateStage>("active");

  
  // LiveKit connection — browser mic → agent (Deepgram STT) → data channel → these state vars.
  const {
    status: livekitStatus,
    error: livekitError,
    sessions,
    flags, // Extracting our live backend flags directly from the hook
    debateTurns,
    clearDebate,
    connect,
    disconnect,
    muteMicrophone,
    unmuteMicrophone,
  } = useLiveKitRoom(mode === "debate" && debateStage === "active" ? "debate" : "analysis");

  const enterAnalysisMode = () => {
    setMode("analysis");
    setDebateStage("active");
  };

  const enterDebateMode = () => {
    setMode("debate");
    setDebateStage("active");
    clearDebate();
    void unmuteMicrophone();
  };

  const stopDebate = async () => {
    setDebateStage("stopped");
    await muteMicrophone();
  };

  const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const draftText = latestSession
    ? `${latestSession.text}${
        latestSession.pendingText ? `${latestSession.text ? " " : ""}${latestSession.pendingText}` : ""
      }`.trim()
    : "";
  const latestUserTurnText = [...debateTurns]
    .reverse()
    .find((turn) => turn.role === "user")
    ?.text.trim() ?? "";
  const liveUserDraft =
    debateStage === "active" && draftText && draftText !== latestUserTurnText ? draftText : "";


  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* Floating dev control: connect the browser mic to the LiveKit room. */}
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border bg-card/90 px-3 py-2 text-sm shadow">
        <span className="font-medium">LiveKit:</span>
        <span>{livekitStatus}</span>
        <div className="mx-1 h-4 w-px bg-border" />
        <span className="font-medium">Mode:</span>
        <button
          onClick={enterAnalysisMode}
          className={`rounded px-2 py-1 ${mode === "analysis" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
        >
          Analysis
        </button>
        <button
          onClick={enterDebateMode}
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
      {mode === "analysis" ? (
        <>
          <TranscriptPanel sessions={sessions} flags={flags} isLive={livekitStatus === "connected"} />
          <FactCheckSidebar flags={flags} />
        </>
      ) : (
        <DebateChatPanel
          turns={debateTurns}
          liveUserDraft={liveUserDraft}
          isLive={livekitStatus === "connected" && debateStage === "active"}
          isStopped={debateStage === "stopped"}
          onStop={stopDebate}
        />
      )}
    </main>
  );
};

export default Index;