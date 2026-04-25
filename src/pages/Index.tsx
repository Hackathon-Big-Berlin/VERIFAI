import { useEffect, useState } from "react";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { getMockFactCheckFlags } from "@/lib/mockdata/fact-checks";
import { getMockTranscriptLines } from "@/lib/mockdata/transcript";
import type { FactCheckFlag, TranscriptLine } from "@/lib/types";

const transcriptLines = getMockTranscriptLines();
const factCheckFlags = getMockFactCheckFlags();

const flaggedTranscriptIndexes = new Map<number, number>([
  [1, 0],
  [3, 1],
  [5, 2],
]);

const Index = () => {
  const [visibleLines, setVisibleLines] = useState<TranscriptLine[]>([]);
  const [visibleFlags, setVisibleFlags] = useState<FactCheckFlag[]>([]);

  useEffect(() => {
    let currentIndex = 0;

    // TODO: LiveKit function call would happen here.
    // TODO: Replace with real LiveKit data channel payload.
    const intervalId = window.setInterval(() => {
      const nextLine = transcriptLines[currentIndex];

      if (!nextLine) {
        window.clearInterval(intervalId);
        return;
      }

      setVisibleLines((currentLines) => [...currentLines, nextLine]);

      const flagIndex = flaggedTranscriptIndexes.get(currentIndex);
      if (flagIndex !== undefined) {
        const nextFlag = factCheckFlags[flagIndex];
        setVisibleFlags((currentFlags) => [...currentFlags, nextFlag]);
      }

      currentIndex += 1;
    }, 1400);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      <TranscriptPanel lines={visibleLines} />
      <FactCheckSidebar flags={visibleFlags} />
    </main>
  );
};

export default Index;
