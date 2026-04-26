import { ScrollArea } from "@/components/ui/scroll-area";
import type { FactCheckFlag } from "@/lib/types";
import { FactCheckCard } from "./FactCheckCard";

type FactCheckSidebarProps = {
  flags: FactCheckFlag[];
};

export function FactCheckSidebar({ flags }: FactCheckSidebarProps) {
  return (
    <aside className="flex min-h-[24rem] w-full flex-col bg-secondary lg:w-[24rem] xl:w-[28rem]">
      <header className="border-b border-border px-4 py-4 md:px-6">
        <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">Fact-checks</p>
        <h2 className="text-xl font-semibold leading-tight text-secondary-foreground">Flagged claims</h2>
      </header>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4 md:p-6" aria-live="polite" aria-label="Incoming fact-check flags">
          {flags.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
              No claims flagged yet.
            </div>
          ) : (
            // Newest first so the latest fact-check appears at the top.
            [...flags].reverse().map((flag) => (
              <FactCheckCard key={`${flag.claim}|${flag.verdict}`} flag={flag} />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

