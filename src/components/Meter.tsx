import React from "react";
import { motion } from "framer-motion";
import type { FactCheckFlag } from "@/lib/types";

interface MeterProps {
  flags: FactCheckFlag[];
  activeSessionId: string | null;
}

export const Meter: React.FC<MeterProps> = ({ flags, activeSessionId }) => {
  // Only calculate meter state for the currently active session
  const sessionFlags = activeSessionId ? flags.filter((f) => f.sessionId === activeSessionId) : [];
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

  const getPercentage = (count: number) => (total === 0 ? 0 : (count / total) * 100);

  return (
    <div className="w-full rounded-xl border border-white/10 bg-black/40 p-4 flex flex-col gap-3 shadow-[0_4px_30px_rgba(0,0,0,0.5)] backdrop-blur-md z-10 mb-4 transition-all">
      <div className="flex justify-between items-center text-xs font-semibold uppercase tracking-widest text-white/80">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
          Live Session Meter
        </span>
        <span className="text-white/50">Claims: <span className="text-white">{total}</span></span>
      </div>
      
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-white/5 border border-white/10 shadow-inner">
        {total === 0 ? (
          <div className="w-full h-full bg-transparent" />
        ) : (
          <>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getPercentage(counts["TRUE"])}%` }}
              transition={{ type: "spring", stiffness: 50, damping: 15 }}
              className="h-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]"
              title={`True: ${counts["TRUE"]}`}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getPercentage(counts["PARTIALLY TRUE"])}%` }}
              transition={{ type: "spring", stiffness: 50, damping: 15 }}
              className="h-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.8)]"
              title={`Partially True: ${counts["PARTIALLY TRUE"]}`}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getPercentage(counts["FALSE"])}%` }}
              transition={{ type: "spring", stiffness: 50, damping: 15 }}
              className="h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"
              title={`False: ${counts["FALSE"]}`}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${getPercentage(counts["INCONCLUSIVE"])}%` }}
              transition={{ type: "spring", stiffness: 50, damping: 15 }}
              className="h-full bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.8)]"
              title={`Inconclusive: ${counts["INCONCLUSIVE"]}`}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-[11px] font-bold tracking-wide uppercase justify-center mt-1">
        <span className="text-green-400 drop-shadow-[0_0_5px_rgba(34,197,94,0.4)]">True: {counts["TRUE"]}</span>
        <span className="text-orange-400 drop-shadow-[0_0_5px_rgba(249,115,22,0.4)]">Mixed: {counts["PARTIALLY TRUE"]}</span>
        <span className="text-red-400 drop-shadow-[0_0_5px_rgba(239,68,68,0.4)]">False: {counts["FALSE"]}</span>
        <span className="text-slate-400 drop-shadow-[0_0_5px_rgba(148,163,184,0.4)]">Inconclusive: {counts["INCONCLUSIVE"]}</span>
      </div>
    </div>
  );
};