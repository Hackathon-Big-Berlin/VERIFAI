import { ScrollArea } from "@/components/ui/scroll-area";
import type { TranscriptLine as TranscriptLineType } from "@/lib/types";
import { TranscriptLine } from "./TranscriptLine";

type TranscriptPanelProps = {
  lines: TranscriptLineType[];
};

export function TranscriptPanel({ lines }: TranscriptPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-border bg-background lg:border-b-0 lg:border-r">
      <header className="flex items-center justify-between border-b border-border px-4 py-4 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Live transcript</p>
          <h1 className="text-2xl font-semibold leading-tight text-foreground md:text-3xl">TruWord</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
          Listening
        </div>
      </header>

      <ScrollArea className="min-h-[28rem] flex-1 lg:min-h-0">
        <div aria-live="polite" aria-label="Incoming transcript lines">
          {lines.length === 0 ? (
            <div className="px-4 py-10 text-muted-foreground md:px-6">Waiting for transcript audio...</div>
          ) : (
            lines.map((line, index) => (
              <TranscriptLine key={line.id} line={line} isLatest={index === lines.length - 1} />
            ))
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
