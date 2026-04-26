import asyncio
import os
import json
import logging
import dotenv
from typing import List, Dict, Any
from tavily import AsyncTavilyClient
from google import genai
from google.genai import types

from schemas import CLAIMS_SCHEMA, VERDICT_SCHEMA

dotenv.load_dotenv()
logger = logging.getLogger("agent")

# Constants
GEMINI_MODEL_NAME = 'gemini-3.1-flash-lite-preview'
SEARCH_DEPTH = 'advanced'


def _get_gemini_api_key() -> str:
    """Returns Gemini API key from explicit env vars, or raises a clear error."""
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "Missing Gemini API key. Set GOOGLE_API_KEY (preferred) or GEMINI_API_KEY."
        )
    return api_key


def _get_tavily_api_key() -> str:
    """Returns Tavily API key from the explicit TAVILY_API_KEY env var."""
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise ValueError("Missing Tavily API key. Set TAVILY_API_KEY.")
    return api_key

# Verdict prompt is now plain — no need to spell out the JSON shape because
# VERDICT_SCHEMA enforces it via Gemini's response_schema config.
GEMINI_PROMPT = '''
You are an expert, highly objective fact-checking AI. Evaluate the accuracy of the CLAIM based strictly on the provided CONTEXT (search snippets + source URLs).

Act as a ruthless evaluator. Do not rely on your internal knowledge. If the context lacks the answer, return INCONCLUSIVE.

Return a verdict, concise reasoning citing the context, and 1-3 source URLs from the context that support your verdict.
'''


def _get_claims_prompt(text_block: str) -> str:
    return f"""Consider this speech: {text_block}.

Extract the main factual claims made by the speaker.
CRITICAL RULES:
1. Quote each claim exactly as it appears in the speech, character by character.
2. Do not paraphrase, summarize, or alter a single word or punctuation mark.
3. Every claim must be a direct, verbatim substring of the provided speech.
4. Include enough context for each claim that the verdict isn't ambiguous. If enough context for a claim isn't provided in the speech, don't include it.
"""

async def _process_single_claim(claim: str, tavily_client: AsyncTavilyClient, gemini_client: genai.Client) -> Dict[str, Any]:
    """Worker function to process a single claim asynchronously and parse JSON output."""
    claim = claim.strip()
    
    if not claim:
        return {"claim": claim, "status": "skipped"}

    # Base result structure to ensure the frontend always gets expected keys
    result_data = {
        "claim": claim, # This is now guaranteed to be the exact substring
        "status": "error",
        "verdict": "ERROR",
        "reasoning": "An unexpected error occurred.",
        "sources": []
    }

    try:
        # 1. Gather Context
        search_query = f"Verify the claim: {claim}. Provide supporting and contradicting evidence with dates and sources."
        search_response = await tavily_client.search(search_query, search_depth=SEARCH_DEPTH)
        
        # 2. Fact Check — schema-enforced, no markdown/JSON cleanup needed.
        final_prompt = f'{GEMINI_PROMPT}\n<CLAIM>{claim}</CLAIM>\n<CONTEXT>{search_response}</CONTEXT>'

        response = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=final_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VERDICT_SCHEMA,
            ),
        )

        logger.debug(
            "[FACT_CHECK][GEMINI_RAW_OUTPUT] claim=%s output=%s",
            claim,
            response.text,
        )

        parsed_response = json.loads(response.text)
        
        # Enforce the 1-3 sources rule natively
        extracted_sources = parsed_response.get("sources", [])
        if not isinstance(extracted_sources, list):
            extracted_sources = []
            
        result_data.update({
            "status": "success",
            "verdict": parsed_response.get("verdict", "INCONCLUSIVE"),
            "reasoning": parsed_response.get("reasoning", "No reasoning provided."),
            "sources": extracted_sources[:3] # Clamp to max 3 sources
        })

    except json.JSONDecodeError:
        logger.exception("Failed to parse Gemini fact-check response as JSON")
        result_data["reasoning"] = "Failed to parse the fact-checking model's response into valid JSON."
    except Exception as e:
        logger.exception("Error during fact-checking pipeline for claim")
        result_data["reasoning"] = f"Error during fact-checking pipeline: {str(e)}"

    return result_data

async def run_fact_check_pipeline(text_block: str) -> List[Dict[str, Any]]:
    """
    Main pipeline function. Takes a block of text, extracts exact claims, 
    and fact-checks them concurrently, returning a structured list of dicts.
    """
    if not text_block or not text_block.strip():
        return [{
            "claim": "None", 
            "status": "error", 
            "verdict": "ERROR", 
            "reasoning": "No text provided to check.", 
            "sources": []
        }]

    try:
        tavily_client = AsyncTavilyClient(api_key=_get_tavily_api_key())
        gemini_client = genai.Client(api_key=_get_gemini_api_key())
    except Exception as e:
        logger.exception("Failed to initialize AI clients")
        return [{
            "claim": "System", 
            "status": "error", 
            "verdict": "ERROR", 
            "reasoning": f"Failed to initialize AI clients: {str(e)}", 
            "sources": []
        }]

    try:
        # Step 1: Extract claims — schema-enforced as a JSON array of strings.
        prompt = _get_claims_prompt(text_block)
        parsed_data = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=CLAIMS_SCHEMA,
            ),
        )

        if not parsed_data or not parsed_data.text:
            logger.error("Claim extraction returned empty response")
            return [{
                "claim": "Extraction",
                "status": "error",
                "verdict": "ERROR",
                "reasoning": "Model returned an empty response during claim extraction.",
                "sources": []
            }]

        try:
            claims = json.loads(parsed_data.text)
            if not isinstance(claims, list):
                raise ValueError("Extracted JSON is not a list.")
        except (json.JSONDecodeError, ValueError) as e:
            logger.exception("Failed to parse extracted claims JSON")
            return [{
                "claim": "Extraction",
                "status": "error",
                "verdict": "ERROR",
                "reasoning": f"Failed to parse extracted claims into JSON array: {str(e)}",
                "sources": []
            }]
        
        # Step 2: Set up tasks for concurrent execution
        tasks = [_process_single_claim(claim, tavily_client, gemini_client) for claim in claims]
        
        # Step 3: Execute all network calls concurrently
        raw_results = await asyncio.gather(*tasks, return_exceptions=False)
        
        # Filter out skipped empty rows
        return [res for res in raw_results if res.get("status") != "skipped"]

    except Exception as e:
        logger.exception("Critical orchestrator error in fact-check pipeline")
        return [{
            "claim": "Pipeline", 
            "status": "error", 
            "verdict": "ERROR", 
            "reasoning": f"A critical orchestrator error occurred: {str(e)}", 
            "sources": []
        }]


# ---------------------------------------------------------
# Testing / Demo Block 
# ---------------------------------------------------------
# if __name__ == "__main__":
#     SAMPLE_TEXT = """Friends, look... I know you’re feeling it. When you pull up to the pump or look at that utility bill, it hits the pocketbook. Now, the pundits will tell you we’re in a tailspin, but let’s look at the cold, hard numbers. The global economy is actually projected to grow by 5.2% this year, the highest rate we’ve seen in a decade. We aren’t just recovering; we’re leading.

# And it’s not just about growth; it’s about how we get there. Our critics say we’ve abandoned our energy independence, but the reality is quite different. Last year, for the first time in history, the United States became a net exporter of solar panels to the European Union. We are the engine of the world!"""

#     async def test_run():
#         print("Starting Pipeline...")
#         before = time.perf_counter()
        
#         results = await run_fact_check_pipeline(SAMPLE_TEXT)
        
#         print("\n--- FINAL AGGREGATED RESULTS ---")
#         print(json.dumps(results, indent=2))
            
#         after = time.perf_counter()
#         print(f"\nTotal Pipeline Execution Time: {after - before:.2f}s")

#     asyncio.run(test_run())
