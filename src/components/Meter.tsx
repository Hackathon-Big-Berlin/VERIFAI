import React from "react";
import type { FactCheckFlag } from "@/lib/types";

interface MeterProps {
  flags: FactCheckFlag[];
  activeSessionId: string | null;
  rightSlot?: React.ReactNode;
}

export const Meter: React.FC<MeterProps> = ({ flags, activeSessionId, rightSlot }) => {
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
    <div className="w-full bg-card border-b border-border z-10">
      <div className="flex w-full flex-col md:flex-row">
        <div className="w-full md:w-1/2 p-4 flex flex-col gap-3">
          <div className="flex justify-between items-baseline gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Live Fact Check Meter
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Claims: <span className="text-foreground">{total}</span>
            </span>
          </div>

          <div className="flex h-2 w-full overflow-hidden rounded-sm border border-border bg-muted">
            {total === 0 ? (
              <div className="h-full w-full bg-muted" />
            ) : (
              <>
                <div
                  style={{ width: `${(counts["TRUE"] / total) * 100}%` }}
                  className="bg-foreground transition-all duration-500"
                  title={`True: ${counts["TRUE"]}`}
                />
                <div
                  style={{ width: `${(counts["PARTIALLY TRUE"] / total) * 100}%` }}
                  className="bg-accent transition-all duration-500"
                  title={`Partially True: ${counts["PARTIALLY TRUE"]}`}
                />
                <div
                  style={{ width: `${(counts["FALSE"] / total) * 100}%` }}
                  className="bg-destructive transition-all duration-500"
                  title={`False: ${counts["FALSE"]}`}
                />
                <div
                  style={{ width: `${(counts["INCONCLUSIVE"] / total) * 100}%` }}
                  className="bg-muted-foreground/60 transition-all duration-500"
                  title={`Inconclusive: ${counts["INCONCLUSIVE"]}`}
                />
              </>
            )}
          </div>

          <div className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider">
            <LegendItem swatchClass="bg-foreground" label="True" value={counts["TRUE"]} />
            <LegendItem swatchClass="bg-accent" label="Partial" value={counts["PARTIALLY TRUE"]} />
            <LegendItem swatchClass="bg-destructive" label="False" value={counts["FALSE"]} />
            <LegendItem swatchClass="bg-muted-foreground/60" label="N/A" value={counts["INCONCLUSIVE"]} />
          </div>
        </div>

        {rightSlot ? (
          <div className="w-full md:w-1/2 p-4 md:border-l border-border">
            {rightSlot}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const LegendItem: React.FC<{ swatchClass: string; label: string; value: number }> = ({
  swatchClass,
  label,
  value,
}) => (
  <div className="flex items-center gap-1.5 text-foreground/80">
    <span className={`inline-block h-2 w-2 rounded-sm border border-border ${swatchClass}`} />
    <span className="truncate">{label}</span>
    <span className="ml-auto text-foreground">{value}</span>
  </div>
);
