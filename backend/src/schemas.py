"""Shared schema definitions for the fact-check pipeline.

Two roles:
- Gemini `response_schema` values that force structured output (no markdown
  fences, no malformed JSON — the SDK enforces the shape server-side).
- A frontend payload contract (TypedDict) so the data-channel JSON shape is
  documented in one place and matches what useLiveKitRoom.ts expects.
"""

from typing import List, TypedDict


# Per-claim verdict. Schema-enforced so we never need to clean markdown
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
