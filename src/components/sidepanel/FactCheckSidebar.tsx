import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FactCheckFlag } from "@/lib/types";
import { FactCheckCard } from "./FactCheckCard";

type FactCheckSidebarProps = {
  flags: FactCheckFlag[];
};

export function FactCheckSidebar({ flags }: FactCheckSidebarProps) {
  return (
    <aside className="flex min-h-[24rem] w-full flex-col bg-transparent lg:min-h-0 h-full">
      <header className="border-b border-white/10 bg-black/20 px-4 py-4 md:px-6 backdrop-blur-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">Fact-checks</p>
        <h2 className="text-xl font-bold leading-tight text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">Flagged claims</h2>
      </header>

      <ScrollArea className="flex-1 bg-black/10">
        <div className="space-y-4 p-4 md:p-6" aria-live="polite" aria-label="Incoming fact-check flags">
          <AnimatePresence mode="popLayout">
            {flags.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="rounded-xl border border-dashed border-white/20 bg-white/5 p-4 text-sm leading-6 text-muted-foreground backdrop-blur-sm"
              >
                No claims flagged yet.
              </motion.div>
            ) : (
              // Newest first so the latest fact-check appears at the top.
              [...flags].reverse().map((flag) => (
                <FactCheckCard key={`${flag.claim}|${flag.verdict}`} flag={flag} />
              ))
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </aside>
  );
}