import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DebateChatPanel } from "@/components/debate/DebateChatPanel";
import { FactCheckSidebar } from "@/components/sidepanel/FactCheckSidebar";
import { TranscriptPanel } from "@/components/transcript/TranscriptPanel";
import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";

type AppMode = "analysis" | "debate";
type DebateStage = "active" | "stopped";

const Index = () => {
  const [mode, setMode] = useState<AppMode>("analysis");
  const [debateStage, setDebateStage] = useState<DebateStage>("active");

  const {
    status: livekitStatus,
    error: livekitError,
    sessions,
    flags,
    debateTurns,
    clearDebate,
    connect,
    disconnect,
    muteMicrophone,
    unmuteMicrophone,
  } = useLiveKitRoom(mode === "debate" && debateStage === "active" ? "debate" : "analysis");

  const enterAnalysisMode = () => {
    setMode("analysis");
    setDebateStage("active");
  };

  const enterDebateMode = () => {
    setMode("debate");
    setDebateStage("active");
    clearDebate();
    void unmuteMicrophone();
  };

  const stopDebate = async () => {
    setDebateStage("stopped");
    await muteMicrophone();
  };

  const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  
  const draftText = latestSession
    ? `${latestSession.text}${
        latestSession.pendingText ? `${latestSession.text ? " " : ""}${latestSession.pendingText}` : ""
      }`.trim()
    : "";

  const liveUserDraft = debateStage === "active" ? draftText : "";

  return (
    <main className="flex min-h-screen flex-col bg-transparent text-foreground lg:flex-row relative overflow-hidden p-4 gap-4">
      {/* Dynamic Background Glows */}
      <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }} 
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-1/4 left-1/4 h-[50rem] w-[50rem] rounded-full bg-primary/10 blur-[120px]" 
        />
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }} 
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute -bottom-1/4 right-1/4 h-[40rem] w-[40rem] rounded-full bg-blue-500/10 blur-[100px]" 
        />
      </div>

      {/* Floating Header / Controls */}
      <motion.div 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed left-1/2 top-6 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-black/40 px-6 py-3 text-sm shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${livekitStatus === 'connected' ? 'bg-primary shadow-[0_0_10px_rgba(0,255,255,0.8)] animate-pulse' : 'bg-muted-foreground'}`} />
          <span className="font-semibold tracking-wide uppercase text-xs text-white/80">{livekitStatus}</span>
        </div>
        
        <div className="mx-2 h-5 w-px bg-white/10" />
        
        <div className="flex items-center gap-1 rounded-full bg-white/5 p-1">
          <button
            onClick={enterAnalysisMode}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              mode === "analysis" 
                ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(0,255,255,0.4)]" 
                : "text-muted-foreground hover:text-white"
            }`}
          >
            Analysis
          </button>
          <button
            onClick={enterDebateMode}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
              mode === "debate" 
                ? "bg-primary text-primary-foreground shadow-[0_0_15px_rgba(0,255,255,0.4)]" 
                : "text-muted-foreground hover:text-white"
            }`}
          >
            Debate Coach
          </button>
        </div>

        <div className="mx-2 h-5 w-px bg-white/10" />

        <div className="flex items-center gap-2">
          {mode === "debate" && debateStage === "active" && (
            <button
              onClick={stopDebate}
              className="rounded-full bg-destructive/80 px-4 py-1.5 text-xs font-bold text-white shadow-[0_0_15px_rgba(255,0,0,0.4)] transition-colors hover:bg-destructive"
            >
              Stop
            </button>
          )}
          
          {livekitStatus === "idle" || livekitStatus === "error" ? (
            <button
              onClick={connect}
              className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white backdrop-blur-md transition-colors hover:bg-white/20 border border-white/10"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={disconnect}
              disabled={livekitStatus === "connecting"}
              className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold text-white backdrop-blur-md transition-colors hover:bg-white/20 border border-white/10 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>
        
        {livekitError && (
          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-destructive/90 px-3 py-1 text-xs text-white shadow-lg backdrop-blur-sm">
            {livekitError}
          </span>
        )}
      </motion.div>

      {/* Main Content Area - Z-index 10 to sit above glows but below fixed header */}
      <div className="relative z-10 flex w-full flex-1 flex-col gap-4 pt-20 lg:flex-row">
        <AnimatePresence mode="wait">
          {mode === "analysis" ? (
            <motion.div
              key="analysis-mode"
              initial={{ opacity: 0, x: -20, filter: "blur(10px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: 20, filter: "blur(10px)" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex w-full flex-1 flex-col gap-4 lg:flex-row"
            >
              {/* Wrapping the panels in glassmorphism containers */}
              <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-2xl backdrop-blur-xl">
                <TranscriptPanel sessions={sessions} flags={flags} isLive={livekitStatus === "connected"} />
              </div>
              <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-2xl backdrop-blur-xl lg:w-[24rem] xl:w-[28rem]">
                <FactCheckSidebar flags={flags} />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="debate-mode"
              initial={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.95, filter: "blur(10px)" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-2xl backdrop-blur-xl"
            >
              <DebateChatPanel
                turns={debateTurns}
                liveUserDraft={liveUserDraft}
                isLive={livekitStatus === "connected" && debateStage === "active"}
                isStopped={debateStage === "stopped"}
                onStop={stopDebate}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
};

export default Index;