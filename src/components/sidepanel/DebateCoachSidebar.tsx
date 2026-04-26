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
        <h2 className="text-xl font-semibold leading-tight text-secondary-foreground">Live debate</h2>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4 md:p-6" aria-live="polite" aria-label="Incoming debate events">
          <div className="rounded-md border bg-background p-3 text-sm">
            <p className="font-semibold">Final score</p>
            <p className="text-muted-foreground">
              {finalScore ? `${finalScore.overall}/100` : "Pending..."}
            </p>
          </div>

          <div className="rounded-md border bg-background p-3 text-sm">
            <p className="font-semibold">Turn scoring</p>
            {scores.length === 0 ? (
              <p className="text-muted-foreground">No scored turns yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {[...scores].reverse().slice(0, 4).map((score) => (
                  <li key={score.turnId} className="rounded border border-border/70 p-2">
                    <p className="font-medium">{score.turnId}</p>
                    <p className="text-muted-foreground">Suggestion: {score.coachingSuggestion || "-"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border bg-background p-3 text-sm">
            <p className="font-semibold">Recent turns</p>
            {turns.length === 0 ? (
              <p className="text-muted-foreground">No debate turns yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {[...turns].reverse().slice(0, 6).map((turn) => (
                  <li key={turn.id} className="rounded border border-border/70 p-2">
                    <p className="font-medium capitalize">{turn.role}</p>
                    <p className="line-clamp-3 text-muted-foreground">{turn.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
