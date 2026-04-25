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

export type FactCheckVerdict = "true" | "false" | "disputed" | "inconclusive";

export type FactCheckFlag = {
  type: "flag";
  sentence: string;
  verdict: FactCheckVerdict;
  reason: string;
  source: string;
  // Optional: scopes the highlight to a specific transcript session block.
  // When omitted, the highlighter searches every session for a verbatim match.
  sessionId?: string;
};

// Subjective / normative utterances picked out by Gemini's classification step.
// We don't fact-check these — they only feed the stats header so the audience
// can see how much of what's being said is opinion vs verifiable claim.
export type Opinion = {
  type: "opinion";
  sentence: string;
  sessionId?: string;
};
