import { Fragment, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Mic, MicOff } from "lucide-react";
import type { FactCheckFlag, FactCheckVerdict, TranscriptSession } from "@/lib/types";

type TranscriptPanelProps = {
  sessions: TranscriptSession[];
  flags: FactCheckFlag[];
  // Whether the most recent session is still receiving transcripts. Drives
  // the "Listening" indicator and styles the active block.
  isLive: boolean;
  // Connection controls rendered as a circular action at the bottom-center.
  isIdle?: boolean;
  isConnecting?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
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

// Strip leading/trailing punctuation/whitespace so that claim variants like
// "X.." or " X." still match the canonical span "X" in the transcript.
function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/^[\s.,!?;:'"`-]+|[\s.,!?;:'"`-]+$/g, "");
}

// Find every flag claim in the transcript text and wrap each matching span
// in a colored <mark>. Overlapping matches resolve by keeping the earliest
// (so we never double-wrap). Flags whose claim doesn't appear in the text
// are dropped — the side panel still shows them as cards.
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
      <mark
        key={`m-${i}`}
        className={cn("rounded px-1 py-0.5", highlightClassFor(m.flag.verdict))}
        title={m.flag.reasoning}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    pos = m.end;
  });
  if (pos < text.length) nodes.push(<Fragment key="t-tail">{text.slice(pos)}</Fragment>);

  return nodes;
}

export function TranscriptPanel({
  sessions,
  flags,
  isLive,
  isIdle,
  isConnecting,
  onConnect,
  onDisconnect,
}: TranscriptPanelProps) {
  const showConnect = typeof onConnect === "function" && typeof onDisconnect === "function";
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
              const highlightedText = renderHighlightedTranscript(session.text, flags);

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
                      {highlightedText}
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

      {showConnect ? (
        <div className="flex items-center justify-center border-t border-border bg-background px-4 py-4">
          {isIdle ? (
            <button
              type="button"
              onClick={onConnect}
              aria-label="Connect"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <Mic className="h-6 w-6" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={isConnecting}
              aria-label="Disconnect"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
            >
              <MicOff className="h-6 w-6" />
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
