import type { FactCheckVerdict } from "@/lib/types";

// Centralised verdict styling so the inline transcript highlights and the
// sidebar badges always agree on colour and label.
export const VERDICT_LABEL: Record<FactCheckVerdict, string> = {
  true: "True",
  false: "False",
  disputed: "Disputed",
  inconclusive: "Inconclusive",
};

// Tailwind classes used to highlight verbatim claims inline in the transcript.
// Background is solid enough to be readable on the panel's neutral surfaces.
export const VERDICT_HIGHLIGHT_CLASS: Record<FactCheckVerdict, string> = {
  true: "bg-emerald-200/80 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-50",
  false: "bg-red-200/80 text-red-950 dark:bg-red-900/60 dark:text-red-50",
  disputed: "bg-orange-200/80 text-orange-950 dark:bg-orange-900/60 dark:text-orange-50",
  inconclusive: "bg-muted text-muted-foreground",
};

// Sidebar badge styles — same palette but as Tailwind utility colours that
// work with shadcn's <Badge variant="outline"> baseline.
export const VERDICT_BADGE_CLASS: Record<FactCheckVerdict, string> = {
  true: "border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  false: "border-red-500 bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  disputed: "border-orange-500 bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  inconclusive: "border-muted-foreground/40 bg-muted text-muted-foreground",
};
