import { useEffect, useState } from "react";
import { motion } from "framer-motion";
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
    card: "border-green-500/30 bg-green-500/5 shadow-[0_0_15px_rgba(34,197,94,0.1)]",
    badge: "border-transparent bg-green-500/20 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.3)]",
    quote: "border-green-500/50 text-green-50",
  },
  "FALSE": {
    card: "border-red-500/30 bg-red-500/5 shadow-[0_0_15px_rgba(239,68,68,0.1)]",
    badge: "border-transparent bg-red-500/20 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.3)]",
    quote: "border-red-500/50 text-red-50",
  },
  "PARTIALLY TRUE": {
    card: "border-orange-500/30 bg-orange-500/5 shadow-[0_0_15px_rgba(249,115,22,0.1)]",
    badge: "border-transparent bg-orange-500/20 text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.3)]",
    quote: "border-orange-500/50 text-orange-50",
  },
  "INCONCLUSIVE": {
    card: "border-slate-500/30 bg-slate-500/5 shadow-[0_0_15px_rgba(100,116,139,0.1)]",
    badge: "border-transparent bg-slate-500/20 text-slate-300 shadow-[0_0_10px_rgba(100,116,139,0.3)]",
    quote: "border-slate-500/50 text-slate-200",
  },
};

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
    <motion.article 
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(5px)" }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={cn("rounded-xl border p-5 backdrop-blur-md transition-colors", styles.card)}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={styles.badge}>{verdictLabel[verdict] ?? verdict}</Badge>
          {flag.used_trusted_context && (
            <span
              className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary"
              title="This verdict was likely informed by your uploaded context."
            >
              from context
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">{flag.type}</span>
      </div>
      <blockquote className={cn("border-l-2 pl-4 text-sm font-medium leading-relaxed", styles.quote)}>
        “{claimText}
        {!claimDone && <span className="ml-0.5 inline-block animate-pulse text-white">▍</span>}”
      </blockquote>
      <p className="mt-4 min-h-[1.5rem] text-sm leading-relaxed text-muted-foreground">
        {reasoningText}
        {claimDone && !reasoningDone && <span className="ml-0.5 inline-block animate-pulse text-white">▍</span>}
      </p>

      {reasoningDone && flag.sources && flag.sources.length > 0 && (
        <motion.ul 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 flex flex-wrap gap-2"
        >
          {flag.sources.slice(0, 3).map((url, i) => (
            <li key={`${url}-${i}`}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title={url}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary shadow-[0_0_10px_rgba(255,255,255,0.05)]"
              >
                <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                <span>{sourceLabel(url)}</span>
              </a>
            </li>
          ))}
        </motion.ul>
      )}
    </motion.article>
  );
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}