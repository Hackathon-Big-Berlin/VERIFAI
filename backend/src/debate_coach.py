import json
import logging
import os
from typing import Any, Dict, List

from google import genai

logger = logging.getLogger("agent")

GEMINI_MODEL_NAME = "gemini-3.1-flash-lite-preview"

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

DEBATE_CHAT_PROMPT = """
You are the AI side of a live debate.

Debate style requirements:
1. Be clear, direct, and logically structured.
2. Defend your position firmly, but remain respectful and professional.
3. Address the user's latest argument directly before introducing new points.
4. Avoid insults, mockery, or dismissive language.
5. Keep each response concise and spoken-friendly (about 4-8 sentences).

Context rules:
1. The debate topic is fixed to <TOPIC>.
2. Stay on this topic at all times.
3. Use the recent conversation turns in <CONVERSATION>.

Output rules:
Return valid JSON only with exactly this shape:
{
    "response_text": "..."
}
"""


def _get_gemini_api_key() -> str:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError(
            "Missing Gemini API key. Set GOOGLE_API_KEY (preferred) or GEMINI_API_KEY."
        )
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
    except (TypeError, ValueError):
        score = 0
    return max(0, min(100, score))


def _normalize_scores(scores: Dict[str, Any]) -> Dict[str, int]:
    return {
        "logicalConsistency": _clamp_score(scores.get("logicalConsistency")),
        "evidenceQuality": _clamp_score(scores.get("evidenceQuality")),
        "rebuttalEffectiveness": _clamp_score(scores.get("rebuttalEffectiveness")),
        "clarityStructure": _clamp_score(scores.get("clarityStructure")),
        "responsiveness": _clamp_score(scores.get("responsiveness")),
    }


async def generate_model_turn(user_turn: str, context_snapshot: str) -> Dict[str, Any]:
    """Generate the model debate response for one user turn."""
    client = genai.Client(api_key=_get_gemini_api_key())
    prompt = (
        f"{DEBATE_RESPONSE_PROMPT}\n"
        f"<USER_TURN>{user_turn}</USER_TURN>\n"
        f"<CONTEXT>{context_snapshot}</CONTEXT>"
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
        )
        raw = response.text if response and response.text else "{}"
        parsed = json.loads(_clean_json_response(raw))
    except Exception:
        logger.exception("Failed to generate debate model turn")
        parsed = {}

    return {
        "response_text": str(parsed.get("response_text", "")).strip(),
        "key_points": parsed.get("key_points", []),
        "evidence_citations": parsed.get("evidence_citations", []),
        "attack_strategy_used": parsed.get("attack_strategy_used", []),
    }


async def evaluate_user_turn(user_turn: str, context_snapshot: str) -> Dict[str, Any]:
    """Score a single user turn using the debate rubric."""
    client = genai.Client(api_key=_get_gemini_api_key())
    prompt = (
        f"{DEBATE_EVALUATION_PROMPT}\n"
        f"<USER_TURN>{user_turn}</USER_TURN>\n"
        f"<CONTEXT>{context_snapshot}</CONTEXT>"
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL_NAME,
            contents=prompt,
        )
        raw = response.text if response and response.text else "{}"
        parsed = json.loads(_clean_json_response(raw))
    except Exception:
        logger.exception("Failed to evaluate user debate turn")
        parsed = {}

    scores = _normalize_scores(parsed.get("scores", {}))
    strong_claims = parsed.get("strongClaims", [])
    weak_claims = parsed.get("weakClaims", [])
    suggestion = str(parsed.get("coachingSuggestion", "")).strip()

    return {
        "scores": scores,
        "strongClaims": strong_claims if isinstance(strong_claims, list) else [],
        "weakClaims": weak_claims if isinstance(weak_claims, list) else [],
        "coachingSuggestion": suggestion,
    }


async def generate_debate_reply(
    topic: str,
    conversation: List[Dict[str, str]],
    latest_user_turn: str,
) -> str:
    """Generate the next debate response for chat-like turn taking."""
    client = genai.Client(api_key=_get_gemini_api_key())
    conversation_lines = []
    for turn in conversation[-12:]:
        role = str(turn.get("role", "user")).upper()
        text = str(turn.get("text", "")).strip()
        if text:
            conversation_lines.append(f"{role}: {text}")

    prompt = (
        f"{DEBATE_CHAT_PROMPT}\n"
        f"<TOPIC>{topic}</TOPIC>\n"
        f"<LATEST_USER_TURN>{latest_user_turn}</LATEST_USER_TURN>\n"
        f"<CONVERSATION>{'\\n'.join(conversation_lines)}</CONVERSATION>"
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
            if text:
                return text
        except json.JSONDecodeError:
            # Fallback: model returned plain text; use it directly.
            pass

        return cleaned.strip()
    except Exception:
        logger.exception("Failed to generate debate chat reply")
        return ""


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
