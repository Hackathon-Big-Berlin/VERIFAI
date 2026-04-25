import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FactCheckFlag, FactCheckVerdict, TranscriptSession } from "@/lib/types";

type TranscriptPanelProps = {
  sessions: TranscriptSession[];
  flags: FactCheckFlag[];
  // Whether the most recent session is still receiving transcripts. Drives
  // the "Listening" indicator and styles the active block.
  isLive: boolean;
};

const verdictHighlight: Record<FactCheckVerdict, string> = {
  "TRUE": "bg-green-100 text-green-900 ring-1 ring-green-300",
  "FALSE": "bg-red-100 text-red-900 ring-1 ring-red-300",
  "PARTIALLY TRUE": "bg-orange-100 text-orange-900 ring-1 ring-orange-300",
  "INCONCLUSIVE": "bg-slate-200 text-slate-800 ring-1 ring-slate-300",
};

function highlightClassFor(verdict: string): string {
  return verdictHighlight[verdict as FactCheckVerdict] ?? verdictHighlight["INCONCLUSIVE"];
}

export function TranscriptPanel({ sessions, flags, isLive }: TranscriptPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border bg-background lg:border-b-0 lg:border-r">
      <header className="flex items-center justify-between border-b border-border px-4 py-4 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Live transcript</p>
          <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-3xl">TruWord</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={`h-2.5 w-2.5 rounded-full ${isLive ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`}
            aria-hidden="true"
          />
          {isLive ? "Listening" : "Idle"}
        </div>
      </header>

      <ScrollArea className="min-h-[28rem] flex-1 lg:min-h-0">
        <div aria-live="polite" aria-label="Incoming transcript blocks">
          {sessions.length === 0 ? (
            <div className="px-4 py-10 text-muted-foreground md:px-6">Waiting for transcript audio...</div>
          ) : (
            sessions.map((session, index) => {
              const isActive = isLive && index === sessions.length - 1;
              const hasPending = session.pendingText.length > 0;
              // Inline every flag's claim as a colored span in the active session
              // so the mock payloads render directly in the transcript flow.
              const inlineFlags = isActive ? flags : [];
              const hasAnyText = session.text.length > 0 || hasPending || inlineFlags.length > 0;

              return (
                <article
                  key={session.id}
                  className={`border-b border-border px-4 py-5 md:px-6 ${
                    isActive ? "bg-accent" : "bg-background"
                  }`}
                >
                  <header className="mb-2 flex items-center justify-between text-xs font-mono text-muted-foreground">
                    <span>
                      Session {index + 1} · started {session.startedAt}
                    </span>
                    {isActive ? <span className="text-primary">live</span> : null}
                  </header>

                  {hasAnyText ? (
                    <p className="text-base leading-7 text-foreground md:text-lg">
                      {session.text}
                      {inlineFlags.map((flag, i) => (
                        <span key={`flag-${i}-${flag.verdict}`}>
                          {(session.text || i > 0) ? " " : ""}
                          <mark
                            className={cn("rounded px-1 py-0.5", highlightClassFor(flag.verdict))}
                            title={flag.reasoning}
                          >
                            {flag.claim}
                          </mark>
                        </span>
                      ))}
                      {hasPending ? (
                        <>
                          {(session.text || inlineFlags.length > 0) ? " " : ""}
                          <span className="text-muted-foreground italic">{session.pendingText}</span>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">Listening for speech...</p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
