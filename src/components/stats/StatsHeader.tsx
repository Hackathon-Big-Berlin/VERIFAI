import type { FactCheckFlag, FactCheckVerdict, Opinion } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/verdictStyles";

type StatsHeaderProps = {
  flags: FactCheckFlag[];
  opinions: Opinion[];
};

// Order matters — the stacked truth bar reads left-to-right and the legend
// reads top-to-bottom in the same sequence.
const VERDICT_ORDER: FactCheckVerdict[] = ["true", "disputed", "false", "inconclusive"];

const VERDICT_BAR_CLASS: Record<FactCheckVerdict, string> = {
  true: "bg-emerald-500",
  disputed: "bg-orange-500",
  false: "bg-red-500",
  inconclusive: "bg-muted-foreground/40",
};

const VERDICT_DOT_CLASS: Record<FactCheckVerdict, string> = {
  true: "bg-emerald-500",
  disputed: "bg-orange-500",
  false: "bg-red-500",
  inconclusive: "bg-muted-foreground/40",
};

function countByVerdict(flags: FactCheckFlag[]): Record<FactCheckVerdict, number> {
  return flags.reduce<Record<FactCheckVerdict, number>>(
    (acc, flag) => {
      acc[flag.verdict] = (acc[flag.verdict] ?? 0) + 1;
      return acc;
    },
    { true: 0, false: 0, disputed: 0, inconclusive: 0 },
  );
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function StatsHeader({ flags, opinions }: StatsHeaderProps) {
  const counts = countByVerdict(flags);
  const factualCount = flags.length;
  const opinionCount = opinions.length;

  return (
    <section
      aria-label="Audio intelligence metrics"
      className="border-b border-border bg-card px-4 py-4 md:px-6"
    >
      <div className="grid gap-6 md:grid-cols-[auto_auto_1fr]">
        {/* Counts column */}
        <div className="flex items-center gap-6">
          <Stat label="Opinions" value={opinionCount} />
          <Stat label="Factual statements" value={factualCount} />
        </div>

        {/* Spacer on small screens — divider on large */}
        <div className="hidden md:block md:w-px md:bg-border" aria-hidden="true" />

        {/* Verdict breakdown */}
        <div className="flex flex-col justify-center gap-2">
          <div className="flex h-2 w-1/4 overflow-hidden rounded-full bg-muted">
            {VERDICT_ORDER.map((verdict) => {
              const pct = factualCount === 0 ? 0 : (counts[verdict] / factualCount) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={verdict}
                  className={`h-full ${VERDICT_BAR_CLASS[verdict]}`}
                  style={{ width: `${pct}%` }}
                  aria-label={`${VERDICT_LABEL[verdict]} ${pct.toFixed(0)}%`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            {VERDICT_ORDER.map((verdict) => (
              <div key={verdict} className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${VERDICT_DOT_CLASS[verdict]}`}
                  aria-hidden="true"
                />
                <span className="font-medium text-foreground">{VERDICT_LABEL[verdict]}</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatPercent(counts[verdict], factualCount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-3xl font-semibold tabular-nums text-foreground md:text-4xl">
        {value}
      </span>
    </div>
  );
}
