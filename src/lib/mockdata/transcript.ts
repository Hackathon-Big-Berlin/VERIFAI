import type { TranscriptLine } from "@/lib/types";

export function getMockTranscriptLines(): TranscriptLine[] {
  return [
    {
      id: "line-001",
      timestamp: "00:04",
      speaker: "Host",
      text: "Welcome back. Today we are looking at several climate and energy claims made during the briefing.",
    },
    {
      id: "line-002",
      timestamp: "00:12",
      speaker: "Guest",
      text: "The EU produces 30% of global emissions, so it should carry the majority of the burden.",
    },
    {
      id: "line-003",
      timestamp: "00:21",
      speaker: "Host",
      text: "That number sounds high compared with most recent international inventories.",
    },
    {
      id: "line-004",
      timestamp: "00:29",
      speaker: "Guest",
      text: "Germany also gets almost all of its electricity from coal today.",
    },
    {
      id: "line-005",
      timestamp: "00:39",
      speaker: "Host",
      text: "Energy mixes have shifted quickly, especially since renewable capacity expanded across Europe.",
    },
    {
      id: "line-006",
      timestamp: "00:48",
      speaker: "Guest",
      text: "Solar power became the cheapest electricity source in history according to global energy analysts.",
    },
    {
      id: "line-007",
      timestamp: "00:58",
      speaker: "Host",
      text: "We will keep checking the figures as this conversation continues.",
    },
  ];
}
