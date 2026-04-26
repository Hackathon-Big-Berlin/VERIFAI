"""Parsing for the user-uploaded context file.

The file is plain text, one statement per line. Lines starting with `#` are
treated as comments. Empty lines are ignored. The list of statements is
either passed straight through (gospel mode) or fed through the fact-check
pipeline for vetting (nuanced mode).
"""

from __future__ import annotations


def parse_context_text(text: str) -> list[str]:
    """Return a list of non-empty, non-comment statements from the raw text."""
    statements: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        statements.append(line)
    return statements


# Lightweight stopword list for the lexical-overlap heuristic that decides
# whether a verdict was likely influenced by trusted context. Doesn't have
# to be perfect — false positives just mean an extra "from context" badge.
_STOPWORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "can", "of", "in", "on", "at", "to",
    "from", "by", "for", "with", "as", "and", "or", "but", "not", "no",
    "this", "that", "these", "those", "it", "its", "i", "you", "he", "she",
    "we", "they", "them", "us", "him", "her", "my", "your", "his", "their",
    "our", "if", "so", "than", "then", "there", "here", "what", "which",
    "who", "whom", "whose", "where", "when", "why", "how", "all", "any",
    "some", "more", "most", "much", "many", "few", "less", "least",
})


def _tokens(text: str) -> set[str]:
    return {
        w.lower().strip(".,!?;:'\"`-()[]{}")
        for w in text.split()
        if w
    } - _STOPWORDS


def context_likely_relevant(claim: str, trusted_context: str, threshold: int = 3) -> bool:
    """Heuristic: did the trusted context likely influence this verdict?

    Returns True when `threshold` or more non-stopword tokens are shared
    between the claim and the context. Used to drive a "from context" badge
    on the frontend without the LLM having to declare its sourcing.
    """
    if not trusted_context.strip() or not claim.strip():
        return False
    return len(_tokens(claim) & _tokens(trusted_context)) >= threshold
