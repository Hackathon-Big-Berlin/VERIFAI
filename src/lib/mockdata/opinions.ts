import type { Opinion } from "@/lib/types";
import { DEMO_SESSION_ID } from "./fact-checks";

// Mock opinions pinned to the demo transcript so the stats header has
// non-zero opinion counts on first load.
export function getMockOpinions(): Opinion[] {
  return [
    {
      type: "opinion",
      sessionId: DEMO_SESSION_ID,
      sentence: "it should carry the majority of the burden",
    },
    {
      type: "opinion",
      sessionId: DEMO_SESSION_ID,
      sentence: "That number sounds high compared with most recent international inventories.",
    },
    {
      type: "opinion",
      sessionId: DEMO_SESSION_ID,
      sentence: "We will keep checking the figures as this conversation continues.",
    },
  ];
}
