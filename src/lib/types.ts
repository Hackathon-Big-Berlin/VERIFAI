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
  verdict: string;
  reasoning: string;
  sources: string[];
  // Tagged by useLiveKitRoom with the active session id when the flag arrives,
  // so Meter can scope its counts to the current Connect→Disconnect cycle.
  sessionId: string;
  // Reserved for backend-driven "this verdict was informed by uploaded
  // context" badge; the current backend never sets it.
  used_trusted_context?: boolean;
}

export type DebateRole = "user" | "model";

export interface DebateRubricScores {
  logicalConsistency: number;
  evidenceQuality: number;
  rebuttalEffectiveness: number;
  clarityStructure: number;
  responsiveness: number;
}

export interface DebateTurn {
  id: string;
  role: DebateRole;
  text: string;
  timestamp: string;
  sources?: string[];
}

export interface DebateClaimAnnotation {
  claim: string;
  strength: "strong" | "weak";
  reason: string;
}

export interface DebateTurnScore {
  turnId: string;
  scores: DebateRubricScores;
  strongClaims: DebateClaimAnnotation[];
  weakClaims: DebateClaimAnnotation[];
  coachingSuggestion: string;
}

export interface DebateFinalScore {
  overall: number;
  scores: DebateRubricScores;
  summary: string;
}
