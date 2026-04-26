import { ScrollArea } from "@/components/ui/scroll-area";
import type { DebateFinalScore, DebateTurn, DebateTurnScore } from "@/lib/types";

type DebateCoachSidebarProps = {
  turns: DebateTurn[];
  scores: DebateTurnScore[];
  finalScore: DebateFinalScore | null;
};

export function DebateCoachSidebar({ turns, scores, finalScore }: DebateCoachSidebarProps) {
  return (
    <aside className="flex min-h-[24rem] w-full flex-col bg-secondary lg:min-h-0 lg:w-[24rem] xl:w-[28rem]">
      <header className="border-b border-border px-4 py-4 md:px-6">
        <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
          Debate coach
        </p>
        <h2 className="text-xl font-semibold leading-tight text-secondary-foreground">Debate chat</h2>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4 md:p-6" aria-live="polite" aria-label="Incoming debate events">
          {turns.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
              Start speaking in debate mode. After 7 seconds of silence, the model replies.
            </div>
          ) : (
            <div className="space-y-3">
              {turns.map((turn) => {
                const isUser = turn.role === "user";
                return (
                  <article
                    key={turn.id}
                    className={`max-w-[92%] rounded-lg border p-3 text-sm leading-6 ${
                      isUser
                        ? "ml-auto border-primary/30 bg-primary/10 text-foreground"
                        : "mr-auto border-border bg-background text-foreground"
                    }`}
                  >
                    <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                      {isUser ? "You" : "Debate model"}
                    </p>
                    <p>{turn.text}</p>
                  </article>
                );
              })}
            </div>
          )}

          {/* Keep rubric payload visible but secondary while debate chat flow is being refined. */}
          {(scores.length > 0 || finalScore) && (
            <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
              <p>Scoring updates received: {scores.length}</p>
              <p>Final score: {finalScore ? `${finalScore.overall}/100` : "pending"}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
