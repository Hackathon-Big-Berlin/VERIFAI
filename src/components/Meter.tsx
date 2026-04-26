import React from "react";
import type { FactCheckFlag } from "@/lib/types";
import { motion } from "framer-motion";

interface MeterProps {
  flags: FactCheckFlag[];
  activeSessionId: string | null;
}

export const Meter: React.FC<MeterProps> = ({ flags, activeSessionId }) => {
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

  // Calculate percentages safely to avoid NaN when total is 0
  const getWidth = (count: number) => (total === 0 ? 0 : (count / total) * 100);

  return (
    <div className="w-full bg-background/80 backdrop-blur-xl border-b border-border/50 p-4 flex flex-col gap-3 shadow-sm z-30 relative">
      <div className="flex justify-between items-center text-sm font-semibold text-foreground/80">
        <span className="tracking-wide">Live Accuracy Meter</span>
        <span className="bg-secondary/50 px-2 py-1 rounded-md border border-border/50">
          Claims Analyzed: <span className="text-foreground">{total}</span>
        </span>
      </div>
      
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-secondary/40 border border-border/30 shadow-inner">
        {total === 0 ? (
          <div className="w-full h-full bg-secondary/20" />
        ) : (
          <>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getWidth(counts["TRUE"])}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"
              title={`True: ${counts["TRUE"]}`}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getWidth(counts["PARTIALLY TRUE"])}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]"
              title={`Partially True: ${counts["PARTIALLY TRUE"]}`}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getWidth(counts["FALSE"])}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
              title={`False: ${counts["FALSE"]}`}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getWidth(counts["INCONCLUSIVE"])}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="bg-slate-500 shadow-[0_0_10px_rgba(100,116,139,0.5)]"
              title={`Inconclusive: ${counts["INCONCLUSIVE"]}`}
            />
          </>
        )}
      </div>

      <div className="flex gap-4 text-xs font-semibold justify-center mt-1">
        <span className="text-green-700 dark:text-green-400">True: {counts["TRUE"]}</span>
        <span className="text-orange-700 dark:text-orange-400">Partially True: {counts["PARTIALLY TRUE"]}</span>
        <span className="text-red-700 dark:text-red-400">False: {counts["FALSE"]}</span>
        <span className="text-slate-700 dark:text-slate-400">Inconclusive: {counts["INCONCLUSIVE"]}</span>
      </div>
    </div>
  );
}