import asyncio
import time
import os
import json
import logging
import dotenv
from typing import List, Dict, Any
from tavily import AsyncTavilyClient
from google import genai

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

GEMINI_PROMPT = '''
You are an expert, highly objective fact-checking AI. Your sole purpose is to evaluate the accuracy of a specific CLAIM based strictly on the provided CONTEXT. The CONTEXT consists of search results, including snippets and their source URLs.

You must act as a ruthless evaluator. Do not rely on your internal knowledge. If the context lacks the answer, state that it is unverified.

### Instructions:
1. Carefully read the CLAIM and the CONTEXT.
2. Formulate a final verdict based ONLY on the provided evidence.
3. Identify exactly 1 to 3 source URLs from the CONTEXT that directly support your verdict.

### Output Format:
You MUST return your response strictly as a valid JSON object. Do not include markdown blocks. The JSON must have exactly these three keys:
{
    "verdict": "[TRUE / FALSE / PARTIALLY TRUE / INCONCLUSIVE]",
    "reasoning": "[A concise, step-by-step explanation citing the context]",
    "sources": ["[URL_1]", "[URL_2]"] 
}
'''

def _get_claims_prompt(text_block: str) -> str:
    """
    Helper to dynamically generate the extraction prompt.
    Strictly enforces exact character-by-character extraction via JSON.
    """
    return f"""Consider this speech: {text_block}.

Extract the main factual claims made by the speaker. 
CRITICAL RULES:
1. You MUST quote the claim exactly as it appears in the speech, character by character. 
2. Do not paraphrase, summarize, or alter a single word or punctuation mark.
3. Every claim must be a direct, verbatim substring of the provided speech.
4. Make sure to include all necessary context to the claim. Don't provide a claim without any context that could influence the verdict of the claim. If enough context for a claim isn't provided, don't include it.

Output the claims strictly as a valid JSON array of strings. Do not output anything else.
Example format:
[
  "The global economy is actually projected to grow by 5.2% this year",
  "domestic oil production has actually increased by 20% since the start of the conflict."
]
"""

def _clean_json_response(text: str) -> str:
    """Safely strips markdown formatting that LLMs sometimes add to JSON outputs."""
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()

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
        
        # 2. Fact Check
        final_prompt = f'{GEMINI_PROMPT}\n<CLAIM>{claim}</CLAIM>\n<CONTEXT>{search_response}</CONTEXT>'
        
        response = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME, 
            contents=final_prompt
        )

        # Debug visibility: emit Gemini raw fact-check output on every run.
        raw_fact_check_output = response.text if response and response.text else ""
        logger.debug(
            "[FACT_CHECK][GEMINI_RAW_OUTPUT] claim=%s output=%s",
            claim,
            raw_fact_check_output,
        )
        
        # 3. Parse and Validate JSON
        cleaned_text = _clean_json_response(response.text)
        parsed_response = json.loads(cleaned_text)
        
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
        result_data["reasoning"] = "Failed to parse the fact-checking model's response into valid JSON."
    except Exception as e:
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
        tavily_client = AsyncTavilyClient()
        gemini_client = genai.Client(api_key=_get_gemini_api_key())
    except Exception as e:
        return [{
            "claim": "System", 
            "status": "error", 
            "verdict": "ERROR", 
            "reasoning": f"Failed to initialize AI clients: {str(e)}", 
            "sources": []
        }]

    try:
        # Step 1: Extract claims as strict JSON (Now correctly yielding to the event loop)
        prompt = _get_claims_prompt(text_block)
        parsed_data = await gemini_client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME, contents=prompt
        )
        
        if not parsed_data or not parsed_data.text:
            return [{
                "claim": "Extraction", 
                "status": "error", 
                "verdict": "ERROR", 
                "reasoning": "Model returned an empty response during claim extraction.", 
                "sources": []
            }]

        # Clean and parse the JSON array of claims
        cleaned_extraction = _clean_json_response(parsed_data.text)
        try:
            claims = json.loads(cleaned_extraction)
            if not isinstance(claims, list):
                raise ValueError("Extracted JSON is not a list.")
        except (json.JSONDecodeError, ValueError) as e:
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
