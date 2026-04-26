import React from "react";
import type { FactCheckFlag } from "@/lib/types";

interface MeterProps {
  flags: FactCheckFlag[];
  activeSessionId: string | null;
}

export const Meter: React.FC<MeterProps> = ({ flags, activeSessionId }) => {
  // Only calculate meter state for the currently active session
  const sessionFlags = flags.filter((f) => f.sessionId === activeSessionId);
  const total = sessionFlags.length;

  const counts = {
    TRUE: 0,
    FALSE: 0,
    "PARTIALLY TRUE": 0,
    INCONCLUSIVE: 0,
  };

  sessionFlags.forEach((f) => {
    if (f.verdict in counts) {
      counts[f.verdict as keyof typeof counts]++;
    }
  });

  return (
    <div className="w-full bg-card border-b p-4 flex flex-col gap-2 shadow-sm z-10">
      <div className="flex justify-between items-center text-sm font-semibold text-foreground/80">
        <span>Live Fact Check Meter</span>
        <span>Total Claims Analyzed: {total}</span>
      </div>
      
      <div className="flex h-4 w-full rounded-full overflow-hidden bg-muted">
        {total === 0 ? (
          <div className="w-full h-full bg-secondary/50" />
        ) : (
          <>
            <div
              style={{ width: `${(counts["TRUE"] / total) * 100}%` }}
              className="bg-green-500 transition-all duration-500"
              title={`True: ${counts["TRUE"]}`}
            />
            <div
              style={{ width: `${(counts["PARTIALLY TRUE"] / total) * 100}%` }}
              className="bg-orange-500 transition-all duration-500"
              title={`Partially True: ${counts["PARTIALLY TRUE"]}`}
            />
            <div
              style={{ width: `${(counts["FALSE"] / total) * 100}%` }}
              className="bg-red-500 transition-all duration-500"
              title={`False: ${counts["FALSE"]}`}
            />
            <div
              style={{ width: `${(counts["INCONCLUSIVE"] / total) * 100}%` }}
              className="bg-gray-500 transition-all duration-500"
              title={`Inconclusive: ${counts["INCONCLUSIVE"]}`}
            />
          </>
        )}
      </div>

      <div className="flex gap-4 text-xs font-medium justify-center mt-1">
        <span className="text-green-600 dark:text-green-500">True: {counts["TRUE"]}</span>
        <span className="text-orange-600 dark:text-orange-500">Partially True: {counts["PARTIALLY TRUE"]}</span>
        <span className="text-red-600 dark:text-red-500">False: {counts["FALSE"]}</span>
        <span className="text-gray-600 dark:text-gray-500">Inconclusive: {counts["INCONCLUSIVE"]}</span>
      </div>
    </div>
  );
};