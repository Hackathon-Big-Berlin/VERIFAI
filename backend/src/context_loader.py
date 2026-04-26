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
