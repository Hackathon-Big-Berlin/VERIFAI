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

from schemas import GATEKEEPER_SCHEMA, VERDICT_SCHEMA

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


GATEKEEPER_PROMPT = """Read BACKGROUND_CONTEXT only to resolve pronouns and understand what the speaker is referring to. Then evaluate the TARGET_SENTENCE.

Return is_verifiable=true ONLY if the target sentence contains a factual claim that could be verified by web search (e.g., "Paris is the capital of France", "Cheetahs are the fastest land animal"). Set it to false for opinions ("I think it's nice"), filler ("hello", "you know"), incomplete fragments ("the average human needs"), and personal statements ("my friend Lucas is tall").

If verifiable, generate the optimal Google Search query to verify the claim, resolving any pronouns from the context.
"""


VERDICT_PROMPT = """You are an expert, highly objective fact-checking AI. Evaluate the accuracy of the CLAIM.

If TRUSTED_CONTEXT is non-empty AND it covers the claim, treat it as authoritative — override SEARCH_RESULTS where they conflict. TRUSTED_CONTEXT contains pre-vetted facts the user has provided about the speaker or domain.

If TRUSTED_CONTEXT does not cover the claim (or is empty), evaluate based on SEARCH_RESULTS only. If SEARCH_RESULTS lack the answer, return INCONCLUSIVE.

Do not rely on your internal knowledge. Return a verdict, concise reasoning citing the evidence used, and 1-3 source URLs that support your verdict.
"""


async def fact_check_sentence(
    sentence: str,
    history: str,
    trusted_context: str = "",
) -> Dict[str, Any]:
    """Fact-check a single sentence with prior-sentence history for pronoun resolution.

    `trusted_context` is the user-uploaded background facts (one statement per
    line, already vetted in nuanced mode). When non-empty, the verdict prompt
    treats it as authoritative — overrides web search for matters it covers.

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
        # 1. Gatekeeper. Cheap pass to filter out opinion/filler/fragments
        # before burning a Tavily call.
        gatekeeper_prompt = (
            f"{GATEKEEPER_PROMPT}\n"
            f"<BACKGROUND_CONTEXT>{history}</BACKGROUND_CONTEXT>\n"
            f"<TARGET_SENTENCE>{sentence}</TARGET_SENTENCE>"
        )
        gatekeeper_response = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=gatekeeper_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GATEKEEPER_SCHEMA,
            ),
        )
        gatekeeper_data = json.loads(gatekeeper_response.text)
        if not gatekeeper_data.get("is_verifiable"):
            logger.debug("[gatekeeper] skipped non-verifiable: %s", sentence)
            return {"claim": sentence, "status": "skipped"}

        search_query = gatekeeper_data.get("search_query", "").strip() or (
            f"Verify the claim: {sentence}. Provide supporting and contradicting evidence with dates and sources."
        )
        logger.info("[gatekeeper] verifiable claim, search query: %s", search_query)

        # 2. Web search.
        search_response = await tavily_client.search(search_query, search_depth=SEARCH_DEPTH)

        # 3. Verdict — schema-enforced JSON output.
        verdict_prompt = (
            f"{VERDICT_PROMPT}\n"
            f"<TRUSTED_CONTEXT>{trusted_context}</TRUSTED_CONTEXT>\n"
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