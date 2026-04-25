import { ScrollArea } from "@/components/ui/scroll-area";
import type { FactCheckFlag, TranscriptSession } from "@/lib/types";
import { HighlightedTranscript } from "./HighlightedTranscript";

type TranscriptPanelProps = {
  sessions: TranscriptSession[];
  // Whether the most recent session is still receiving transcripts. Drives
  // the "Listening" indicator and styles the active block.
  isLive: boolean;
  // All fact-check flags. Each session block only renders flags whose
  // `sessionId` matches its id (or has no sessionId — global match).
  flags: FactCheckFlag[];
};

function flagsForSession(allFlags: FactCheckFlag[], sessionId: string): FactCheckFlag[] {
  return allFlags.filter(
    (flag) => flag.sessionId === undefined || flag.sessionId === sessionId,
  );
}

export function TranscriptPanel({ sessions, isLive, flags }: TranscriptPanelProps) {
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
              const hasAnyText = session.text.length > 0 || hasPending;
              const sessionFlags = flagsForSession(flags, session.id);

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
                      <HighlightedTranscript text={session.text} flags={sessionFlags} />
                      {hasPending ? (
                        <>
                          {session.text ? " " : ""}
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
