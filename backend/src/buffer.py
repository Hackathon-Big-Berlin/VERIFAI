"""Sentence-level transcript buffering.

Replaces the rolling word-deque approach. Each finalized STT chunk gets
appended; whenever a complete sentence (ending in . ! ?) is detected, it's
yielded along with a sliding window of recent sentences to give the LLM
just enough context to resolve pronouns. Older sentences fall off the end
so we don't re-fact-check the same claims repeatedly.
"""

import re
from collections import deque


_SENTENCE_PATTERN = re.compile(r"(.*?[.!?])(?:\s+|$)")


class TranscriptBuffer:
    def __init__(self, max_history_sentences: int = 15):
        self._unprocessed = ""
        self._history: deque[str] = deque(maxlen=max_history_sentences)

    def process_chunk(self, text: str) -> list[tuple[str, str]]:
        """Append a transcript chunk; return any newly-completed sentences.

        Each result is `(sentence, history_string)` where `history_string`
        is the recent sentence window joined by spaces (excluding the new
        sentence itself). Use that as background context for the LLM.
        """
        if not text:
            return []

        self._unprocessed = (self._unprocessed + " " + text.strip()).strip()

        results: list[tuple[str, str]] = []
        last_end = 0
        for match in _SENTENCE_PATTERN.finditer(self._unprocessed):
            sentence = match.group(1).strip()
            history = " ".join(self._history)
            results.append((sentence, history))
            self._history.append(sentence)
            last_end = match.end()

        if last_end:
            self._unprocessed = self._unprocessed[last_end:].strip()

        return results
