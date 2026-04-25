export type TranscriptLine = {
  id: string;
  timestamp: string;
  speaker: string;
  text: string;
};

export type FactCheckVerdict = "disputed" | "false" | "needs-context";

export type FactCheckFlag = {
  type: "flag";
  sentence: string;
  verdict: FactCheckVerdict;
  reason: string;
  source: string;
};
