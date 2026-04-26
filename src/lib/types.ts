export type TranscriptLine = {
  id: string;
  timestamp: string;
  speaker: string;
  text: string;
};

// One Connect→Disconnect cycle. Final transcripts append to `text` (separated
// by spaces); the current in-progress utterance lives in `pendingText` and is
// rendered in a muted style so the user sees it stream in. Disconnecting
// freezes the session — the next Connect creates a fresh one underneath.
export type TranscriptSession = {
  id: string;
  startedAt: string;
  text: string;
  pendingText: string;
};

export type FactCheckVerdict = "TRUE" | "FALSE" | "PARTIALLY TRUE" | "INCONCLUSIVE";

export interface FactCheckFlag {
  type: "flag";
  claim: string;
  claim: string;
  verdict: string;
  reasoning: string;
  sources: string[];
  // True when the verdict was likely informed by user-uploaded trusted
  // context (lexical-overlap heuristic on the backend; see
  // backend/src/context_loader.py:context_likely_relevant). Drives the
  // "from context" badge on the side-panel card.
  used_trusted_context?: boolean;
}