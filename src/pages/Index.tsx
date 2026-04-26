import { useRef, type ChangeEvent } from "react";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { useLiveKitRoom, type ContextMode } from "@/hooks/useLiveKitRoom";

const Index = () => {
  const {
    status: livekitStatus,
    error: livekitError,
    sessions,
    flags,
    connect,
    disconnect,
    contextStatus,
    stageContext,
    clearContext,
  } = useLiveKitRoom();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>, mode: ContextMode) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await stageContext(file, mode);
    // Allow re-selecting the same file later.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isIdle = livekitStatus === "idle" || livekitStatus === "error";
  const contextBusy =
    contextStatus.phase === "loading" || contextStatus.phase === "vetting";

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2 rounded-md border bg-card/95 px-3 py-3 text-sm shadow-lg">
        <div className="flex items-center gap-2">
          <span className="font-medium">LiveKit:</span>
          <span className="font-mono text-xs">{livekitStatus}</span>
          {isIdle ? (
            <button
              onClick={connect}
              className="ml-auto rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={disconnect}
              disabled={livekitStatus === "connecting"}
              className="ml-auto rounded bg-destructive px-2 py-1 text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>

        {livekitError ? (
          <span className="text-destructive">{livekitError}</span>
        ) : null}

        {/* Context upload — only visible before connect (Q7). */}
        {isIdle && contextStatus.phase !== "ready" && (
          <ContextStagePanel
            contextStatus={contextStatus}
            fileInputRef={fileInputRef}
            onPickGospel={(e) => handleFileChange(e, "gospel")}
            onPickNuanced={(e) => handleFileChange(e, "nuanced")}
            onClear={clearContext}
          />
        )}

        {/* Live status during/after upload. */}
        {!isIdle && contextStatus.phase !== "none" && (
          <ContextStatusBadge contextStatus={contextStatus} />
        )}

        {contextBusy && (
          <p className="text-xs text-muted-foreground">
            Mic stays muted until vetting finishes.
          </p>
        )}
      </div>

      <TranscriptPanel sessions={sessions} flags={flags} isLive={livekitStatus === "connected"} />
      <FactCheckSidebar flags={flags} />
    </main>
  );
};

type ContextStagePanelProps = {
  contextStatus: ReturnType<typeof useLiveKitRoom>["contextStatus"];
  fileInputRef: React.RefObject<HTMLInputElement>;
  onPickGospel: (e: ChangeEvent<HTMLInputElement>) => void;
  onPickNuanced: (e: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
};

function ContextStagePanel({
  contextStatus,
  fileInputRef,
  onPickGospel,
  onPickNuanced,
  onClear,
}: ContextStagePanelProps) {
  if (contextStatus.phase === "staged") {
    return (
      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Context</div>
        <div className="text-xs">
          <span className="font-mono">{contextStatus.fileName}</span>
          {" — "}
          <span className="font-medium">{contextStatus.mode}</span>
          {" • "}
          {contextStatus.statements.length} statement
          {contextStatus.statements.length === 1 ? "" : "s"}
        </div>
        <p className="text-xs text-muted-foreground">Sent on Connect.</p>
        <button
          onClick={onClear}
          className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        Context (optional)
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">
          Gospel
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={onPickGospel}
          />
        </label>
        <label className="cursor-pointer rounded border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5">
          Nuanced
          <input
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={onPickNuanced}
          />
        </label>
      </div>
      {contextStatus.phase === "error" && (
        <p className="text-xs text-destructive">{contextStatus.error}</p>
      )}
      <p className="text-xs text-muted-foreground">
        .txt, one statement per line, max 32KB.
      </p>
    </div>
  );
}

function ContextStatusBadge({
  contextStatus,
}: {
  contextStatus: ReturnType<typeof useLiveKitRoom>["contextStatus"];
}) {
  if (contextStatus.phase === "none") return null;

  const base = "flex items-center gap-2 border-t border-border pt-2 text-xs";

  if (contextStatus.phase === "error") {
    return <div className={`${base} text-destructive`}>{contextStatus.error}</div>;
  }
  if (contextStatus.phase === "staged") {
    return (
      <div className={`${base} text-muted-foreground`}>
        Context staged ({contextStatus.mode}, {contextStatus.statements.length}) — will send on Connect.
      </div>
    );
  }
  if (contextStatus.phase === "loading") {
    return (
      <div className={`${base} text-muted-foreground`}>
        Sending context ({contextStatus.mode}, {contextStatus.total})…
      </div>
    );
  }
  if (contextStatus.phase === "vetting") {
    return (
      <div className={`${base} text-muted-foreground`}>
        Vetting context: {contextStatus.kept}/{contextStatus.total}
      </div>
    );
  }
  // ready
  return (
    <div className={`${base} text-foreground`}>
      <span className="font-semibold">Context ready</span>
      <span className="text-muted-foreground">
        ({contextStatus.mode}, {contextStatus.kept}/{contextStatus.total} kept)
      </span>
    </div>
  );
}

export default Index;
