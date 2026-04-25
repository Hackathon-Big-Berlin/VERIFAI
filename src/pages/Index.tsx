import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
// Deletion: Removed import { getMockFactCheckFlags } from "@/lib/mockdata/fact-checks";
import type { FactCheckFlag } from "@/lib/types";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";


const Index = () => {

  
  // LiveKit connection — browser mic → agent (Deepgram STT) → data channel → these state vars.
  const {
    status: livekitStatus,
    error: livekitError,
    sessions,
    flags, // Extracting our live backend flags directly from the hook
    connect,
    disconnect,
  } = useLiveKitRoom();


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
      <TranscriptPanel sessions={sessions} flags={flags} isLive={livekitStatus === "connected"} />
      
      {/* Added: Pass the LiveKit flags directly into the sidebar */}
      <FactCheckSidebar flags={flags} />
    </main>
  );
};

export default Index;