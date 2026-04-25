import { useEffect, useState } from "react";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { getMockFactCheckFlags } from "@/lib/mockdata/fact-checks";
import type { FactCheckFlag } from "@/lib/types";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

// Mock fact-check flags still ship until Lukas's Gemini stream is wired in.
const factCheckFlags = getMockFactCheckFlags();

const Index = () => {
  const [visibleFlags, setVisibleFlags] = useState<FactCheckFlag[]>([]);
  // LiveKit connection — browser mic → agent (Deepgram STT) → data channel → these state vars.
  const {
    status: livekitStatus,
    error: livekitError,
    transcripts,
    connect,
    disconnect,
  } = useLiveKitRoom();

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
      <TranscriptPanel lines={transcripts} />
      <FactCheckSidebar flags={visibleFlags} />
    </main>
  );
};

export default Index;
