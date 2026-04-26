import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


class DebateSessionStore:
    """Append-only JSONL storage for debate session events."""

    def __init__(self, base_dir: str = "debate_sessions") -> None:
        self.base_path = Path(base_dir)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _session_file(self, session_id: str) -> Path:
        return self.base_path / f"{session_id}.jsonl"

    def append_event(self, session_id: str, event: Dict[str, Any]) -> None:
        payload = {
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            **event,
        }
        with self._session_file(session_id).open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
