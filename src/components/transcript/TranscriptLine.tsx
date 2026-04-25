import type { TranscriptLine as TranscriptLineType } from "@/lib/types";

type TranscriptLineProps = {
  line: TranscriptLineType;
  isLatest?: boolean;
};

export function TranscriptLine({ line, isLatest = false }: TranscriptLineProps) {
  return (
    <article
      className={`grid gap-3 border-b border-border px-4 py-4 transition-colors md:grid-cols-[4.5rem_7rem_1fr] md:px-6 ${
        isLatest ? "bg-accent" : "bg-background"
      }`}
    >
      <time className="font-mono text-xs leading-6 text-muted-foreground" dateTime={line.timestamp}>
        {line.timestamp}
      </time>
      <p className="text-sm font-semibold leading-6 text-foreground">{line.speaker}</p>
      <p className="text-base leading-7 text-foreground md:text-lg">{line.text}</p>
    </article>
  );
}
