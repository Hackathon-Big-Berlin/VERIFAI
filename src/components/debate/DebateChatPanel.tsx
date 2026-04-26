import { ScrollArea } from "@/components/ui/scroll-area";
import type { DebateTurn } from "@/lib/types";

type DebateChatPanelProps = {
  turns: DebateTurn[];
  liveUserDraft: string;
  isLive: boolean;
  isStopped: boolean;
  onStop: () => void;
};

export function DebateChatPanel({
  turns,
  liveUserDraft,
  isLive,
  isStopped,
  onStop,
}: DebateChatPanelProps) {
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
        </div>
      </ScrollArea>
    </section>
  );
}
