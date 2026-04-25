import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FactCheckFlag } from "@/lib/types";
import { VERDICT_BADGE_CLASS, VERDICT_LABEL } from "@/lib/verdictStyles";

type FactCheckCardProps = {
  flag: FactCheckFlag;
};

export function FactCheckCard({ flag }: FactCheckCardProps) {
  return (
    <article className="rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <Badge variant="outline" className={VERDICT_BADGE_CLASS[flag.verdict]}>
          {VERDICT_LABEL[flag.verdict]}
        </Badge>
        <span className="font-mono text-xs uppercase tracking-normal text-muted-foreground">{flag.type}</span>
      </div>
      <blockquote className="border-l-2 border-primary pl-3 text-sm font-medium leading-6 text-foreground">
        “{flag.sentence}”
      </blockquote>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{flag.reason}</p>
      <a
        href={flag.source}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Source
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </article>
  );
}
