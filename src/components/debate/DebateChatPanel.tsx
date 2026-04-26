import { useEffect, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DebateFinalScore, DebateTurn, DebateTurnScore } from "@/lib/types";

type DebateChatPanelProps = {
  turns: DebateTurn[];
  scores: DebateTurnScore[];
  finalScore: DebateFinalScore | null;
  liveUserDraft: string;
  isLive: boolean;
  isStopped: boolean;
  isIdle?: boolean;
  isConnecting?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onStop: () => void;
};

export function DebateChatPanel({
  turns,
  scores,
  finalScore,
  liveUserDraft,
  isLive,
  isStopped,
  isIdle,
  isConnecting,
  onConnect,
  onDisconnect,
  onStop,
}: DebateChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const showConnect = typeof onConnect === "function" && typeof onDisconnect === "function";
  const allStrongClaims = scores.flatMap((s) => s.strongClaims ?? []);
  const allWeakClaims = scores.flatMap((s) => s.weakClaims ?? []);
  const allFallacies = scores.flatMap((s) => s.logicalFallacies ?? []);
  const allSuggestions = scores
    .map((s) => s.coachingSuggestion?.trim())
    .filter((text): text is string => Boolean(text));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [turns, liveUserDraft, isLive]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-4 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
            Debate mode
          </p>
          <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-3xl">
            Live debate chat
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {isStopped ? "Stopped" : isLive ? "Listening" : "Idle"}
          </span>
          <button
            onClick={onStop}
            disabled={isStopped}
            className="rounded bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-50"
          >
            Stop debate
          </button>
        </div>
      </header>

      <ScrollArea className="min-h-[28rem] flex-1 lg:min-h-0">
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-5 md:px-6">
          {turns.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
              Start speaking to open the debate. The model replies after 7 seconds of silence.
            </div>
          ) : (
            turns.map((turn) => {
              const isUser = turn.role === "user";
              return (
                <article
                  key={turn.id}
                  className={`max-w-[85%] rounded-lg border p-3 text-sm leading-6 ${
                    isUser
                      ? "ml-auto border-primary/30 bg-primary/10 text-foreground"
                      : "mr-auto border-border bg-muted/30 text-foreground"
                  }`}
                >
                  <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    {isUser ? "You" : "Debate model"}
                  </p>
                  <p>{turn.text}</p>
                </article>
              );
            })
          )}

          {liveUserDraft ? (
            <article className="ml-auto max-w-[85%] rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-6 text-foreground">
              <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                You (speaking)
              </p>
              <p className="italic">{liveUserDraft}</p>
            </article>
          ) : null}

          {isStopped ? (
            <article className="rounded-lg border border-border bg-muted/20 p-4 text-sm leading-6 text-foreground">
              <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                Debate summary
              </p>
              {finalScore ? (
                <div className="space-y-3">
                  <p className="font-medium">Overall score: {finalScore.overall}/100</p>
                  <p className="text-muted-foreground">{finalScore.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    Logic {finalScore.scores.logicalConsistency} | Evidence {finalScore.scores.evidenceQuality} |
                    Rebuttal {finalScore.scores.rebuttalEffectiveness} | Clarity {finalScore.scores.clarityStructure} |
                    Responsiveness {finalScore.scores.responsiveness}
                  </p>

                  {allStrongClaims.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                        Strong points
                      </p>
                      <ul className="list-disc pl-5">
                        {allStrongClaims.slice(0, 4).map((item, idx) => (
                          <li key={`${item.claim}-${idx}`}>{item.claim}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {allWeakClaims.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                        Weak points
                      </p>
                      <ul className="list-disc pl-5">
                        {allWeakClaims.slice(0, 4).map((item, idx) => (
                          <li key={`${item.claim}-${idx}`}>{item.claim}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {allFallacies.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                        Logical fallacies
                      </p>
                      <ul className="list-disc pl-5">
                        {allFallacies.slice(0, 4).map((item, idx) => (
                          <li key={`${item.fallacy}-${idx}`}>{item.fallacy}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {allSuggestions.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                        Coaching tips
                      </p>
                      <ul className="list-disc pl-5">
                        {allSuggestions.slice(0, 3).map((tip, idx) => (
                          <li key={`${tip}-${idx}`}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {finalScore.topWeaknesses && finalScore.topWeaknesses.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Top weaknesses: {finalScore.topWeaknesses.slice(0, 5).join(", ")}
                    </p>
                  ) : null}
                  {finalScore.nextSteps && finalScore.nextSteps.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Next steps: {finalScore.nextSteps.slice(0, 3).join(" | ")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Computing post-debate analysis... keep this screen open for a few seconds.
                </p>
              )}
            </article>
          ) : null}

          <div ref={bottomRef} aria-hidden="true" />
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
