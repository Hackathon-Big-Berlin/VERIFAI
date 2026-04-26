import json
import logging
import os
from typing import Any, Dict, List

from google import genai
from google.genai import types
from tavily import AsyncTavilyClient

logger = logging.getLogger("agent")

GEMINI_MODEL_NAME = "gemini-3.1-flash-lite-preview"
SEARCH_DEPTH = "advanced"
MAX_TAVILY_RESULTS = 5

DEBATE_RESPONSE_PROMPT = """
You are a debate opponent. Respond to the USER turn with a concise spoken-style rebuttal.

Rules:
1. Stay on topic and argue against the user's position.
2. Keep response to 2-4 short paragraphs suitable for text-to-speech.
3. Do not invent citations. If uncertain, acknowledge uncertainty.
4. Avoid personal attacks and unsafe content.

Output must be valid JSON only:
{
  "response_text": "...",
  "key_points": ["...", "..."],
  "evidence_citations": ["https://..."],
  "attack_strategy_used": ["counterexample", "burden_of_proof"]
}
"""

DEBATE_EVALUATION_PROMPT = """
You are a strict debate coach evaluator for the USER turn.

Evaluate whether the user defended their claims, rebutted opposing arguments,
and used evidence and logic effectively.

Return valid JSON only with this shape:
{
  "scores": {
    "logicalConsistency": 0,
    "evidenceQuality": 0,
    "rebuttalEffectiveness": 0,
    "clarityStructure": 0,
    "responsiveness": 0
  },
  "strongClaims": [
    {"claim": "...", "strength": "strong", "reason": "..."}
  ],
  "weakClaims": [
    {"claim": "...", "strength": "weak", "reason": "..."}
  ],
  "coachingSuggestion": "..."
}
"""

DEBATE_EVALUATION_WITH_CLAIMS_PROMPT = """
You are a strict debate coach evaluator for the USER turn.

Evaluate whether the user defended their claims, rebutted opposing arguments,
and used evidence and logic effectively.

Use the provided claim checks as supporting evidence when scoring the turn.

Return valid JSON only with this shape:
{
    "scores": {
        "logicalConsistency": 0,
        "evidenceQuality": 0,
        "rebuttalEffectiveness": 0,
        "clarityStructure": 0,
        "responsiveness": 0
    },
    "strongClaims": [
        {"claim": "...", "strength": "strong", "reason": "..."}
    ],
    "weakClaims": [
        {"claim": "...", "strength": "weak", "reason": "..."}
    ],
    "logicalFallacies": [
        {"fallacy": "...", "evidence": "...", "reason": "..."}
    ],
    "argumentImpact": "...",
    "coachingSuggestion": "..."
}
"""

DEBATE_CHAT_PROMPT = """
You are the AI side of a live debate.

Debate style requirements:
1. Be clear, direct, and logically structured.
2. Defend your position firmly, but remain respectful and professional.
3. Address the user's latest argument directly before introducing new points.
4. Avoid insults, mockery, or dismissive language.
5. Keep each response concise and spoken-friendly (about 4-8 sentences).
6. Ground factual claims in WEB_EVIDENCE when available.
7. If the user asks for sources or evidence, explicitly list URL citations.

Context rules:
1. The debate topic is fixed to <TOPIC>.
2. Stay on this topic at all times.
3. Use the recent conversation turns in <CONVERSATION>.
4. Treat WEB_EVIDENCE as your primary factual grounding source.

Output rules:
Return valid JSON only with exactly this shape:
{
    "response_text": "...",
    "sources": ["https://...", "https://..."]
}
"""

DEBATE_RESEARCH_QUERY_PROMPT = """
You create a single high-quality web-search query for debate research.

Rules:
1. Focus on claims that matter for the latest user argument.
2. Prefer concrete terms (names, dates, places, measurable outcomes).
3. Keep query concise and specific.

Return valid JSON only:
{
  "search_query": "..."
}
"""

DEBATE_RESEARCH_QUERY_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "search_query": {"type": "STRING"},
    },
    "required": ["search_query"],
}


def _get_gemini_api_key() -> str:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "Missing Gemini API key. Set GOOGLE_API_KEY (preferred) or GEMINI_API_KEY."
        )
    return api_key


def _get_tavily_api_key() -> str:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise ValueError("Missing Tavily API key. Set TAVILY_API_KEY.")
    return api_key


def _clean_json_response(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def _clamp_score(value: Any) -> int:
    try:
        score = int(float(value))
        return max(0, min(100, score))
    except (ValueError, TypeError):
        return 0


def _extract_sources(search_response: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    for item in search_response.get("results", [])[:MAX_TAVILY_RESULTS]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url", "")).strip()
        if url and url not in urls:
            urls.append(url)
    return urls


def _format_search_context(search_response: Dict[str, Any]) -> str:
    lines: List[str] = []
    for i, item in enumerate(search_response.get("results", [])[:MAX_TAVILY_RESULTS], start=1):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip() or "Untitled"
        url = str(item.get("url", "")).strip()
        snippet = str(item.get("content", "")).strip().replace("\n", " ")
        if len(snippet) > 600:
            snippet = f"{snippet[:600]}..."
        lines.append(f"[{i}] {title}\nURL: {url}\nSnippet: {snippet}")
    return "\n\n".join(lines)


async def _build_research_query(
    topic: str,
    conversation: List[Dict[str, str]],
    latest_user_turn: str,
) -> str:
    client = genai.Client(api_key=_get_gemini_api_key())
    conversation_lines: List[str] = []
    for turn in conversation[-8:]:
        role = str(turn.get("role", "user")).upper()
        text = str(turn.get("text", "")).strip()
        if text:
            conversation_lines.append(f"{role}: {text}")

    conversation_block = "\n".join(conversation_lines)
    prompt = (
        f"{DEBATE_RESEARCH_QUERY_PROMPT}\n"
        f"<TOPIC>{topic}</TOPIC>\n"
        f"<LATEST_USER_TURN>{latest_user_turn}</LATEST_USER_TURN>\n"
        f"<CONVERSATION>{conversation_block}</CONVERSATION>"
    )

    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=DEBATE_RESEARCH_QUERY_SCHEMA,
        ),
    )
    data = json.loads(response.text)
    query = str(data.get("search_query", "")).strip()
    return query or f"{topic} {latest_user_turn}".strip()


async def generate_debate_reply(
    topic: str,
    conversation: List[Dict[str, str]],
    latest_user_turn: str,
) -> Dict[str, Any]:
    """Generate the next debate response for chat-like turn taking."""
    client = genai.Client(api_key=_get_gemini_api_key())
    conversation_lines = []
    for turn in conversation[-12:]:
        role = str(turn.get("role", "user")).upper()
        text = str(turn.get("text", "")).strip()
        if text:
            conversation_lines.append(f"{role}: {text}")

    search_query = ""
    search_context = ""
    sources: List[str] = []

    try:
        search_query = await _build_research_query(topic, conversation, latest_user_turn)
        tavily_client = AsyncTavilyClient(api_key=_get_tavily_api_key())
        search_response = await tavily_client.search(search_query, search_depth=SEARCH_DEPTH)
        sources = _extract_sources(search_response)
        search_context = _format_search_context(search_response)
    except Exception:
        logger.exception("[debate] research step failed; falling back to non-grounded response")

    conversation_block = "\n".join(conversation_lines)
    prompt = (
        f"{DEBATE_CHAT_PROMPT}\n"
        f"<TOPIC>{topic}</TOPIC>\n"
        f"<LATEST_USER_TURN>{latest_user_turn}</LATEST_USER_TURN>\n"
        f"<CONVERSATION>{conversation_block}</CONVERSATION>\n"
        f"<SEARCH_QUERY>{search_query}</SEARCH_QUERY>\n"
        f"<WEB_EVIDENCE>{search_context}</WEB_EVIDENCE>"
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
        )
        raw = response.text if response and response.text else ""
        cleaned = _clean_json_response(raw)

        # Preferred: structured JSON payload with response_text.
        try:
            parsed = json.loads(cleaned)
            text = str(parsed.get("response_text", "")).strip()
            model_sources = parsed.get("sources", [])
            if not isinstance(model_sources, list):
                model_sources = []
            merged_sources = [str(url).strip() for url in model_sources if str(url).strip()]
            for url in sources:
                if url and url not in merged_sources:
                    merged_sources.append(url)
            if text:
                return {"response_text": text, "sources": merged_sources[:5]}
        except json.JSONDecodeError:
            # Fallback: model returned plain text; use it directly.
            pass

        return {"response_text": cleaned.strip(), "sources": sources[:5]}
    except Exception:
        logger.exception("Failed to generate debate chat reply")
        return {"response_text": "", "sources": sources[:5]}


async def evaluate_user_turn_coaching(
    topic: str,
    user_turn: str,
    conversation: List[Dict[str, str]],
    claim_checks: List[Dict[str, Any]],
) -> Dict[str, Any]:
    client = genai.Client(api_key=_get_gemini_api_key())

    conversation_lines: List[str] = []
    for turn in conversation[-12:]:
        role = str(turn.get("role", "user")).upper()
        text = str(turn.get("text", "")).strip()
        if text:
            conversation_lines.append(f"{role}: {text}")

    claim_check_lines: List[str] = []
    for check in claim_checks[:10]:
        claim = str(check.get("claim", "")).strip()
        verdict = str(check.get("verdict", "")).strip()
        reasoning = str(check.get("reasoning", "")).strip()
        sources = check.get("sources", [])
        source_text = ", ".join(str(url).strip() for url in sources if str(url).strip())
        claim_check_lines.append(
            f"CLAIM: {claim}\nVERDICT: {verdict}\nREASONING: {reasoning}\nSOURCES: {source_text}"
        )

    prompt = (
        f"{DEBATE_EVALUATION_WITH_CLAIMS_PROMPT}\n"
        f"<TOPIC>{topic}</TOPIC>\n"
        f"<USER_TURN>{user_turn}</USER_TURN>\n"
        f"<CONVERSATION>{'\\n'.join(conversation_lines)}</CONVERSATION>\n"
        f"<CLAIM_CHECKS>{'\\n\n'.join(claim_check_lines)}</CLAIM_CHECKS>"
    )

    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL_NAME,
        contents=prompt,
    )

    raw = response.text if response and response.text else ""
    cleaned = _clean_json_response(raw)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.exception("Failed to parse debate coaching response")
        return {
            "scores": {
                "logicalConsistency": 0,
                "evidenceQuality": 0,
                "rebuttalEffectiveness": 0,
                "clarityStructure": 0,
                "responsiveness": 0,
            },
            "strongClaims": [],
            "weakClaims": [],
            "logicalFallacies": [],
            "argumentImpact": "",
            "coachingSuggestion": "",
        }

    scores = parsed.get("scores", {})
    if not isinstance(scores, dict):
        scores = {}

    normalized_scores = {
        "logicalConsistency": _clamp_score(scores.get("logicalConsistency", 0)),
        "evidenceQuality": _clamp_score(scores.get("evidenceQuality", 0)),
        "rebuttalEffectiveness": _clamp_score(scores.get("rebuttalEffectiveness", 0)),
        "clarityStructure": _clamp_score(scores.get("clarityStructure", 0)),
        "responsiveness": _clamp_score(scores.get("responsiveness", 0)),
    }

    strong_claims = parsed.get("strongClaims", [])
    if not isinstance(strong_claims, list):
        strong_claims = []

    weak_claims = parsed.get("weakClaims", [])
    if not isinstance(weak_claims, list):
        weak_claims = []

    logical_fallacies = parsed.get("logicalFallacies", [])
    if not isinstance(logical_fallacies, list):
        logical_fallacies = []

    return {
        "scores": normalized_scores,
        "strongClaims": strong_claims[:5],
        "weakClaims": weak_claims[:5],
        "logicalFallacies": logical_fallacies[:5],
        "argumentImpact": str(parsed.get("argumentImpact", "")).strip(),
        "coachingSuggestion": str(parsed.get("coachingSuggestion", "")).strip(),
    }


def compute_final_score(score_rows: List[Dict[str, int]]) -> Dict[str, Any]:
    """Average rubric axes and derive an overall score from weighted sums."""
    if not score_rows:
        empty = {
            "logicalConsistency": 0,
            "evidenceQuality": 0,
            "rebuttalEffectiveness": 0,
            "clarityStructure": 0,
            "responsiveness": 0,
        }
        return {
            "overall": 0,
            "scores": empty,
            "summary": "No scored debate turns were available.",
        }

    keys = [
        "logicalConsistency",
        "evidenceQuality",
        "rebuttalEffectiveness",
        "clarityStructure",
        "responsiveness",
    ]
    averaged = {
        key: round(sum(int(row.get(key, 0)) for row in score_rows) / len(score_rows))
        for key in keys
    }

    overall = round(
        averaged["logicalConsistency"] * 0.25
        + averaged["evidenceQuality"] * 0.20
        + averaged["rebuttalEffectiveness"] * 0.20
        + averaged["clarityStructure"] * 0.15
        + averaged["responsiveness"] * 0.20
    )

    summary = (
        "Final score blends logic, evidence, rebuttal quality, clarity, and responsiveness "
        "across scored turns."
    )

    return {
        "overall": int(overall),
        "scores": averaged,
        "summary": summary,
    }
