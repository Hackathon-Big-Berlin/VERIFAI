import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { FactCheckFlag } from "@/lib/types";
import { VERDICT_HIGHLIGHT_CLASS, VERDICT_LABEL } from "@/lib/verdictStyles";

type HighlightedTranscriptProps = {
  text: string;
  flags: FactCheckFlag[];
};

type Range = {
  flag: FactCheckFlag;
  start: number;
  end: number;
};

// Locate every flag's verbatim sentence in the text and return non-overlapping
// ranges sorted by start. If a later flag overlaps an earlier one, the later
// one is dropped — fact_checker.py guarantees verbatim claims so overlap is
// rare in practice, but we don't want to crash the renderer when it happens.
function buildRanges(text: string, flags: FactCheckFlag[]): Range[] {
  const matches: Range[] = [];
  for (const flag of flags) {
    const start = text.indexOf(flag.sentence);
    if (start < 0) continue;
    matches.push({ flag, start, end: start + flag.sentence.length });
  }
  matches.sort((a, b) => a.start - b.start);

  const nonOverlapping: Range[] = [];
  for (const range of matches) {
    const last = nonOverlapping[nonOverlapping.length - 1];
    if (last && range.start < last.end) continue;
    nonOverlapping.push(range);
  }
  return nonOverlapping;
}

export function HighlightedTranscript({ text, flags }: HighlightedTranscriptProps) {
  if (!text) return null;
  const ranges = buildRanges(text, flags);
  if (ranges.length === 0) return <>{text}</>;

  const segments: JSX.Element[] = [];
  let cursor = 0;
  ranges.forEach((range, idx) => {
    if (range.start > cursor) {
      segments.push(
        <span key={`text-${idx}`}>{text.slice(cursor, range.start)}</span>,
      );
    }
    segments.push(
      <TooltipProvider key={`flag-${idx}`} delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <mark
              className={`cursor-help rounded px-1 ${VERDICT_HIGHLIGHT_CLASS[range.flag.verdict]}`}
            >
              {text.slice(range.start, range.end)}
            </mark>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs space-y-2">
            <p className="font-semibold">{VERDICT_LABEL[range.flag.verdict]}</p>
            <p className="text-sm leading-snug">{range.flag.reason}</p>
            {range.flag.source ? (
              <a
                href={range.flag.source}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-xs text-primary underline-offset-4 hover:underline"
              >
                {range.flag.source}
              </a>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) {
    segments.push(<span key="text-tail">{text.slice(cursor)}</span>);
  }
  return <>{segments}</>;
}
