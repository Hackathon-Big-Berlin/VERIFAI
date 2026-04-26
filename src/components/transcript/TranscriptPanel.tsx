import { Fragment, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Meter } from "@/components/Meter";
import { cn } from "@/lib/utils";
import type { FactCheckFlag, FactCheckVerdict, TranscriptSession } from "@/lib/types";

type TranscriptPanelProps = {
  sessions: TranscriptSession[];
  flags: FactCheckFlag[];
  isLive: boolean;
};

const verdictHighlight: Record<FactCheckVerdict, string> = {
  "TRUE": "bg-green-500/20 text-green-100 ring-1 ring-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.3)]",
  "FALSE": "bg-red-500/20 text-red-100 ring-1 ring-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]",
  "PARTIALLY TRUE": "bg-orange-500/20 text-orange-100 ring-1 ring-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.3)]",
  "INCONCLUSIVE": "bg-slate-500/20 text-slate-100 ring-1 ring-slate-500/50 shadow-[0_0_10px_rgba(100,116,139,0.3)]",
};

function highlightClassFor(verdict: string): string {
  return verdictHighlight[verdict as FactCheckVerdict] ?? verdictHighlight["INCONCLUSIVE"];
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/^[\s.,!?;:'"`-]+|[\s.,!?;:'"`-]+$/g, "");
}

function renderHighlightedTranscript(text: string, flags: FactCheckFlag[]): ReactNode {
  if (!text || flags.length === 0) return text;

  type Match = { start: number; end: number; flag: FactCheckFlag };
  const lowered = text.toLowerCase();
  const matches: Match[] = [];

  for (const flag of flags) {
    const needle = normalizeForSearch(flag.claim);
    if (!needle) continue;
    const idx = lowered.indexOf(needle);
    if (idx === -1) continue;
    matches.push({ start: idx, end: idx + needle.length, flag });
  }

  if (matches.length === 0) return text;

  matches.sort((a, b) => a.start - b.start);

  const cleaned: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    cleaned.push(m);
    cursor = m.end;
  }

  const nodes: ReactNode[] = [];
  let pos = 0;
  cleaned.forEach((m, i) => {
    if (m.start > pos) nodes.push(<Fragment key={`t-${i}`}>{text.slice(pos, m.start)}</Fragment>);
    nodes.push(
      <motion.mark
        initial={{ opacity: 0, backgroundColor: "rgba(0,0,0,0)" }}
        animate={{ opacity: 1, backgroundColor: "var(--tw-bg-opacity)" }}
        key={`m-${i}`}
        className={cn("rounded px-1.5 py-0.5 mx-0.5 transition-colors duration-500", highlightClassFor(m.flag.verdict))}
        title={m.flag.reasoning}
      >
        {text.slice(m.start, m.end)}
      </motion.mark>,
    );
    pos = m.end;
  });
  if (pos < text.length) nodes.push(<Fragment key="t-tail">{text.slice(pos)}</Fragment>);

  return nodes;
}

export function TranscriptPanel({ sessions, flags, isLive }: TranscriptPanelProps) {
  const activeSessionId = isLive && sessions.length > 0 ? sessions[sessions.length - 1].id : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-transparent border-r border-white/10 relative">
      <header className="flex flex-col border-b border-white/10 bg-black/20 p-4 md:p-6 backdrop-blur-md z-20">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">Live transcript</p>
            <h1 className="text-2xl font-bold leading-tight text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] md:text-3xl">TruWord</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isLive ? "bg-primary animate-pulse shadow-[0_0_10px_rgba(0,255,255,0.8)]" : "bg-muted-foreground/40"}`}
              aria-hidden="true"
            />
            <span className="uppercase tracking-widest text-[10px] font-bold">{isLive ? "Listening" : "Idle"}</span>
          </div>
        </div>

        {/* Injected Glassmorphic Meter */}
        <Meter flags={flags} activeSessionId={activeSessionId} />
      </header>

      <ScrollArea className="min-h-[28rem] flex-1 bg-black/10">
        <div aria-live="polite" aria-label="Incoming transcript blocks">
          <AnimatePresence mode="popLayout">
            {sessions.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="px-4 py-10 text-muted-foreground md:px-6"
              >
                Waiting for transcript audio...
              </motion.div>
            ) : (
              sessions.map((session, index) => {
                const isActive = isLive && index === sessions.length - 1;
                const hasPending = session.pendingText.length > 0;
                const hasAnyText = session.text.length > 0 || hasPending;
                const highlightedText = renderHighlightedTranscript(session.text, flags);

                return (
                  <motion.article
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={session.id}
                    className={`border-b border-white/5 px-4 py-5 md:px-6 transition-colors ${
                      isActive ? "bg-white/5 shadow-[inset_4px_0_0_rgba(0,255,255,0.5)]" : "bg-transparent"
                    }`}
                  >
                    <header className="mb-3 flex items-center justify-between text-xs font-mono text-muted-foreground/60">
                      <span>
                        Session {index + 1} <span className="mx-1">•</span> {session.startedAt}
                      </span>
                      {isActive ? <span className="text-primary font-bold shadow-primary/50 drop-shadow-md">LIVE</span> : null}
                    </header>

                    {hasAnyText ? (
                      <p className="text-base leading-relaxed text-white/90 md:text-lg">
                        {highlightedText}
                        {hasPending ? (
                          <>
                            {session.text ? " " : ""}
                            <span className="text-white/50 italic">{session.pendingText}</span>
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground/50">Listening for speech...</p>
                    )}
                  </motion.article>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </section>
  );
}