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
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={styles.badge}>{verdictLabel[verdict] ?? verdict}</Badge>
          {flag.used_trusted_context && (
            <span
              className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
              title="This verdict was likely informed by your uploaded context."
            >
              from context
            </span>
          )}
        </div>
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
        <ul className="mt-4 flex flex-col gap-1.5">
          {flag.sources.slice(0, 3).map((url, i) => (
            <li key={`${url}-${i}`}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span className="truncate">{sourceLabel(url)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// Show a friendly hostname (e.g. "wikipedia.org") for the link text rather
// than the raw URL or a generic "Source". Falls back to the original URL if
// it can't be parsed.
function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
