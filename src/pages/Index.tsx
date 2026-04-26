import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { Meter } from "@/components/Meter";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

const Index = () => {
  const {
    status: livekitStatus,
    error: livekitError,
    sessions,
    flags,
    activeSessionId,
    connect,
    disconnect,
  } = useLiveKitRoom();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top level meter displaying live stats for the current session */}
      <Meter flags={flags} activeSessionId={activeSessionId} />

      {/* Main split view layout */}
      <main className="flex flex-1 flex-col lg:flex-row relative">
        <div className="fixed right-4 top-20 z-50 flex items-center gap-2 rounded-md border bg-card/90 px-3 py-2 text-sm shadow">
          <span className="font-medium">LiveKit:</span>
          <span>{livekitStatus}</span>
          {livekitStatus === "idle" || livekitStatus === "error" ? (
            <button
              onClick={connect}
              className="rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="rounded bg-destructive px-2 py-1 text-destructive-foreground hover:opacity-90 transition-opacity"
              disabled={livekitStatus === "connecting"}
            >
              Disconnect
            </button>
          )}
          {livekitError ? <span className="text-destructive">{livekitError}</span> : null}
        </div>
        
        <TranscriptPanel sessions={sessions} flags={flags} isLive={livekitStatus === "connected"} />
        <FactCheckSidebar flags={flags} />
      </main>
    </div>
  );
};

export default Index;