import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { DebateChatPanel } from "@/components/debate/DebateChatPanel";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { Meter } from "@/components/Meter";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

type AppMode = "normal" | "interview" | "debate";
type DebateStage = "active" | "stopped";

const Index = () => {
  const [mode, setMode] = useState<AppMode>("normal");
  const [debateStage, setDebateStage] = useState<DebateStage>("active");

  const {
    status: livekitStatus,
    error: livekitError,
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
  } = useLiveKitRoom(
    mode === "debate" && debateStage === "active" ? "debate" : mode === "interview" ? "interview" : "normal",
  );

  const isIdle = livekitStatus === "idle" || livekitStatus === "error";
  const isDebate = mode === "debate";

  const handleModeChange = (next: AppMode) => {
    if (next === mode) return;
    setMode(next);
    setDebateStage("active");
    if (next === "debate") {
      clearDebate();
      void unmuteMicrophone();
    }
  };

  const stopDebate = async () => {
    setDebateStage("stopped");
    await muteMicrophone();
  };

  const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const draftText = latestSession
    ? `${latestSession.text}${
        latestSession.pendingText
          ? `${latestSession.text ? " " : ""}${latestSession.pendingText}`
          : ""
      }`.trim()
    : "";
  const liveUserDraft = debateStage === "active" ? draftText : "";

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Meter
        flags={flags}
        activeSessionId={activeSessionId}
        rightSlot={
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Mode
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex w-28 items-center justify-between gap-1 rounded-sm border border-border bg-primary px-2.5 py-1.5 font-mono text-xs uppercase tracking-wider text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      {mode}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(["normal", "interview", "debate"] as const).map((option) => (
                      <DropdownMenuItem
                        key={option}
                        onSelect={() => handleModeChange(option)}
                        className="font-mono text-xs uppercase tracking-wider"
                      >
                        {option}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              

              {isDebate ? (
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Debate
                    </span>
                    <button
                      type="button"
                      onClick={stopDebate}
                      disabled={debateStage === "stopped"}
                      className="inline-flex w-28 items-center justify-center rounded-sm border border-border bg-destructive px-2.5 py-1.5 font-mono text-xs uppercase tracking-wider text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {debateStage === "stopped" ? "Stopped" : "Stop"}
                    </button>
                </div>
              ) : null}
            </div>

            {livekitError ? (
              <span className="text-destructive">{livekitError}</span>
            ) : null}
          </div>
        }
      />

      <main className="relative flex flex-1 flex-col lg:flex-row">
        {isDebate ? (
          <DebateChatPanel
            turns={debateTurns}
            scores={debateScores}
            finalScore={debateFinalScore}
            liveUserDraft={liveUserDraft}
            isLive={livekitStatus === "connected" && debateStage === "active"}
            isStopped={debateStage === "stopped"}
            isIdle={isIdle}
            isConnecting={livekitStatus === "connecting"}
            onConnect={connect}
            onDisconnect={disconnect}
            onStop={stopDebate}
          />
        ) : (
          <>
            <TranscriptPanel
              sessions={sessions}
              flags={flags}
              isLive={livekitStatus === "connected"}
              isIdle={isIdle}
              isConnecting={livekitStatus === "connecting"}
              onConnect={connect}
              onDisconnect={disconnect}
            />
            <FactCheckSidebar flags={flags} />
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
