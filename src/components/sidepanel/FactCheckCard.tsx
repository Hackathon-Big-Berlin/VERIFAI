import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FactCheckFlag, FactCheckVerdict } from "@/lib/types";

const verdictLabel: Record<FactCheckVerdict, string> = {
  "TRUE": "True",
  "FALSE": "False",
  "PARTIALLY TRUE": "Partially True",
  "INCONCLUSIVE": "Inconclusive",
};

const verdictStyles: Record<FactCheckVerdict, { card: string; badge: string; quote: string }> = {
  "TRUE": {
    card: "border-green-300 bg-green-50",
    badge: "border-transparent bg-green-600 text-white hover:bg-green-600/90",
    quote: "border-green-500",
  },
  "FALSE": {
    card: "border-red-300 bg-red-50",
    badge: "border-transparent bg-red-600 text-white hover:bg-red-600/90",
    quote: "border-red-500",
  },
  "PARTIALLY TRUE": {
    card: "border-orange-300 bg-orange-50",
    badge: "border-transparent bg-orange-500 text-white hover:bg-orange-500/90",
    quote: "border-orange-500",
  },
  "INCONCLUSIVE": {
    card: "border-slate-300 bg-slate-100",
    badge: "border-transparent bg-slate-500 text-white hover:bg-slate-500/90",
    quote: "border-slate-400",
  },
};

// Animate text appearing one character at a time so each flag feels like it's
// streaming in, even though the payload arrives as a single data-channel message.
function useTypewriter(text: string, speed: number, enabled: boolean) {
  const [displayed, setDisplayed] = useState("");

  useEffect(() => {
    if (!enabled) {
      setDisplayed("");
      return;
    }
    setDisplayed("");
    if (!text) return;

    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, enabled]);

  return { displayed, isDone: enabled && displayed.length === text.length };
}

type FactCheckCardProps = {
  flag: FactCheckFlag;
};

export function FactCheckCard({ flag }: FactCheckCardProps) {
  const verdict = flag.verdict as FactCheckVerdict;
  const styles = verdictStyles[verdict] ?? verdictStyles["INCONCLUSIVE"];

  const { displayed: claimText, isDone: claimDone } = useTypewriter(flag.claim, 18, true);
  const { displayed: reasoningText, isDone: reasoningDone } = useTypewriter(flag.reasoning, 12, claimDone);

  return (
    <article className={cn("rounded-md border p-4 text-card-foreground shadow-sm transition-colors", styles.card)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <Badge className={styles.badge}>{verdictLabel[verdict] ?? verdict}</Badge>
        <span className="font-mono text-xs uppercase tracking-normal text-muted-foreground">{flag.type}</span>
      </div>
      <blockquote className={cn("border-l-2 pl-3 text-sm font-medium leading-6 text-foreground", styles.quote)}>
        “{claimText}
        {!claimDone && <span className="ml-0.5 inline-block animate-pulse">▍</span>}”
      </blockquote>
      <p className="mt-3 min-h-[1.5rem] text-sm leading-6 text-muted-foreground">
        {reasoningText}
        {claimDone && !reasoningDone && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
      </p>

      {reasoningDone && flag.sources && flag.sources.length > 0 && (
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
