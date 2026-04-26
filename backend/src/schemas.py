"""Shared schema definitions for the fact-check pipeline.

Two roles:
- Gemini `response_schema` values that force structured output (no markdown
  fences, no malformed JSON — the SDK enforces the shape server-side).
- A frontend payload contract (TypedDict) so the data-channel JSON shape is
  documented in one place and matches what useLiveKitRoom.ts expects.
"""

from typing import List, TypedDict


# Stage 1 — gatekeeper. Cheap call: is this sentence even worth searching?
# Skips opinion/filler/incomplete-fragment speech before we burn a Tavily
# call. When verifiable, the LLM also returns a tuned search query that
# resolves any pronouns from the surrounding history.
GATEKEEPER_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "is_verifiable": {
            "type": "BOOLEAN",
            "description": (
                "True if the target sentence contains a factual claim that can be "
                "verified via web search."
            ),
        },
        "search_query": {
            "type": "STRING",
            "description": (
                "Optimal Google Search query to verify the claim. Resolve any "
                "pronouns using the background context. Empty if not verifiable."
            ),
        },
    },
    "required": ["is_verifiable"],
}


# Stage 2 — verdict. Schema-enforced so we never need to clean markdown
# fences or recover from malformed JSON.
VERDICT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "verdict": {
            "type": "STRING",
            "enum": ["TRUE", "FALSE", "PARTIALLY TRUE", "INCONCLUSIVE"],
            "description": "Final evaluation based strictly on the provided context.",
        },
        "reasoning": {
            "type": "STRING",
            "description": "Concise step-by-step explanation citing the context.",
        },
        "sources": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "1-3 source URLs from the context that support the verdict.",
        },
    },
    "required": ["verdict", "reasoning", "sources"],
}


class FactCheckPayload(TypedDict):
    """JSON contract for `topic="flag"` data-channel messages.

    Mirrors the FactCheckFlag type in src/lib/types.ts.
    """

    type: str        # always "flag"
    claim: str
    verdict: str     # "TRUE" | "FALSE" | "PARTIALLY TRUE" | "INCONCLUSIVE"
    reasoning: str
    sources: List[str]
