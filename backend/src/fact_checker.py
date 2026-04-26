"""Fact-check pipeline: takes one sentence + recent-sentence history, returns
a single verdict dict.

The sentence IS the claim (no extraction step) — buffer.py guarantees we get
complete sentences. History is provided so the LLM can resolve pronouns, not
to widen the scope of what's being checked.
"""

import os
import json
import logging
from typing import Any, Dict

import dotenv
from tavily import AsyncTavilyClient
from google import genai
from google.genai import types

from schemas import VERDICT_SCHEMA

dotenv.load_dotenv()
logger = logging.getLogger("agent")

GEMINI_MODEL_NAME = 'gemini-3.1-flash-lite-preview'
SEARCH_DEPTH = 'advanced'


def _get_gemini_api_key() -> str:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("Missing Gemini API key. Set GOOGLE_API_KEY (preferred) or GEMINI_API_KEY.")
    return api_key


def _get_tavily_api_key() -> str:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise ValueError("Missing Tavily API key. Set TAVILY_API_KEY.")
    return api_key


VERDICT_PROMPT = """You are an expert, highly objective fact-checking AI. Evaluate the accuracy of the CLAIM based strictly on the provided CONTEXT (search snippets + source URLs).

Use BACKGROUND_CONTEXT only to resolve pronouns and understand what the speaker is referring to — not as evidence.

Act as a ruthless evaluator. Do not rely on your internal knowledge. If the SEARCH_RESULTS lack the answer, return INCONCLUSIVE.

Return a verdict, concise reasoning citing the search results, and 1-3 source URLs that support your verdict.
"""


async def fact_check_sentence(sentence: str, history: str) -> Dict[str, Any]:
    """Fact-check a single sentence with prior-sentence history for pronoun resolution.

    Always returns a dict with the same shape:
        {claim, status, verdict, reasoning, sources}
    `status` is one of: "success", "skipped", "error".
    """
    sentence = sentence.strip()

    if not sentence:
        return {"claim": sentence, "status": "skipped"}

    result_data: Dict[str, Any] = {
        "claim": sentence,
        "status": "error",
        "verdict": "ERROR",
        "reasoning": "An unexpected error occurred.",
        "sources": [],
    }

    try:
        tavily_client = AsyncTavilyClient(api_key=_get_tavily_api_key())
        gemini_client = genai.Client(api_key=_get_gemini_api_key())
    except Exception as e:
        logger.exception("Failed to initialize AI clients")
        result_data["reasoning"] = f"Failed to initialize AI clients: {e!s}"
        return result_data

    try:
        # 1. Web search.
        search_query = (
            f"Verify the claim: {sentence}. Provide supporting and contradicting evidence with dates and sources."
        )
        search_response = await tavily_client.search(search_query, search_depth=SEARCH_DEPTH)

        # 2. Verdict — schema-enforced JSON output.
        verdict_prompt = (
            f"{VERDICT_PROMPT}\n"
            f"<BACKGROUND_CONTEXT>{history}</BACKGROUND_CONTEXT>\n"
            f"<CLAIM>{sentence}</CLAIM>\n"
            f"<SEARCH_RESULTS>{search_response}</SEARCH_RESULTS>"
        )
        response = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=verdict_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VERDICT_SCHEMA,
            ),
        )

        logger.debug(
            "[FACT_CHECK][GEMINI_RAW_OUTPUT] claim=%s output=%s",
            sentence,
            response.text,
        )

        parsed = json.loads(response.text)
        sources = parsed.get("sources", [])
        if not isinstance(sources, list):
            sources = []

        result_data.update({
            "status": "success",
            "verdict": parsed.get("verdict", "INCONCLUSIVE"),
            "reasoning": parsed.get("reasoning", "No reasoning provided."),
            "sources": sources[:3],
        })

    except json.JSONDecodeError:
        logger.exception("Failed to parse Gemini verdict response as JSON")
        result_data["reasoning"] = "Failed to parse the fact-checking model's response into valid JSON."
    except Exception as e:
        logger.exception("Error during fact-check pipeline for claim")
        result_data["reasoning"] = f"Error during fact-check pipeline: {e!s}"

    return result_data
