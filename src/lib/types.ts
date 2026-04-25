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

// Find this interface in your types file and update the keys
export interface FactCheckFlag {
  type: "flag";
  claim: string;       // Changed from 'sentence'
  verdict: string;
  reasoning: string;   // Changed from 'reason'
  sources: string[];   // Changed from 'source' (string) to array
}
