import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { FactCheckFlag, FactCheckVerdict } from "@/lib/types";

// Deletion: Removed old lowercase verdict mapping
// Added: Updated map to match the new backend verdict strings
const verdictLabel: Record<FactCheckVerdict, string> = {
  "TRUE": "True",
  "FALSE": "False",
  "PARTIALLY TRUE": "Partially True",
  "INCONCLUSIVE": "Inconclusive",
};

type FactCheckCardProps = {
  flag: FactCheckFlag;
};

export function FactCheckCard({ flag }: FactCheckCardProps) {
  // Logical process: dynamically style the badge based on the new verdict types
  const badgeVariant = flag.verdict === "FALSE" ? "destructive" : 
                       flag.verdict === "TRUE" ? "default" : "secondary";

  return (
    <article className="rounded-md border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <Badge variant={badgeVariant}>{verdictLabel[flag.verdict]}</Badge>
        <span className="font-mono text-xs uppercase tracking-normal text-muted-foreground">{flag.type}</span>
      </div>
      <blockquote className="border-l-2 border-primary pl-3 text-sm font-medium leading-6 text-foreground">
        “{flag.claim}” {/* Updated from flag.sentence */}
      </blockquote>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{flag.reasoning}</p> {/* Updated from flag.reason */}
      
      {/* Added safe check: Only render the source link if the sources array has at least one item */}
      {flag.sources && flag.sources.length > 0 && (
        <a
          href={flag.sources[0]}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Source
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
    </article>
  );
}