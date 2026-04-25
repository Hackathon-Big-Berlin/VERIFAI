# Fact-checking pipeline — current state

End-to-end flow from spoken audio to structured verdict log. As of branch `agent-rebuild` (PR #14).

## Data flow

```
[browser mic]
   │  WebRTC audio
   ▼
[LiveKit room]   ← agent dispatched on token's roomConfig.agents
   │
   ▼
[AgentSession.STT  =  Deepgram nova-3]
   │  emits user_input_transcribed events (interim + final)
   ▼
[forward_transcript_to_data_channel]   ← agent.py
   ├─► publish_data(topic="transcript")  → frontend live-transcript panel
   └─► on is_final:
         · append words to context_words deque (max 500)
         · build context_window = " ".join(context_words)
         · enqueue (version, snapshot) on fact_check_queue
         ▼
[fact_check_worker]   ← background asyncio task in agent.py
   │
   ▼
[run_fact_check_pipeline(snapshot)]   ← fact_checker.py
   ├─ Gemini extracts claims as JSON array of verbatim substrings
   └─ for each claim, in parallel:
        Tavily search (advanced) → Gemini verdict prompt
                                  → JSON {verdict, reasoning, sources}
   │
   ▼
[ logger.info("[worker] pipeline result version=N: ...") ]
   ← currently terminal-only; not yet published to frontend
```

## Components

### STT (Deepgram)
`AgentSession(stt=inference.STT(model="deepgram/nova-3", language="multi"))`

Emits `user_input_transcribed` events as the user speaks. Each event has:
- `transcript: str` — the text
- `is_final: bool` — true once the utterance is committed, false during streaming

### Transcript forwarding & context window
On every event, `forward_transcript_to_data_channel` (in `agent.py`):
- Always publishes the event to topic `"transcript"` so the frontend renders live transcripts.
- On finals only: appends words to `context_words` (deque, `maxlen=500`), rebuilds `context_window` as a space-joined string, increments `context_version`, enqueues `(version, context_window)` on `fact_check_queue`.

The context window is a rolling 500-word view. Every final transcript triggers fact-checking on the **whole** current window, so older claims get re-fact-checked repeatedly. Wasteful API usage worth fixing later (see *Known issues*).

### Worker
`fact_check_worker` is one background `asyncio.Task`. It awaits `fact_check_queue.get()` forever, calls the pipeline, and logs the structured result.

Key behaviors:
- **CancelledError swallowing.** The genai SDK can raise `CancelledError` during livekit session startup (cause=None — likely httpx context teardown). The worker catches it, logs a warning, and continues looping so subsequent items still get processed. Without this, one bad startup call would kill the worker permanently.
- **All exceptions caught.** Anything else gets `logger.exception` and the loop continues.
- **task_done() always.** Wrapped in `finally` so the queue tracks completion correctly.

### Self-test injection
On agent dispatch, the worker is fed one synthetic snapshot:
```python
fact_check_queue.put_nowait((-1, "The capital of France is Berlin."))
```
This exercises the full pipeline without needing the user to speak — useful as a smoke test on every reconnect. Will be removed once publishing is wired and live transcripts cover the same ground.

### Pipeline (`fact_checker.py`)
Two-stage orchestrator:

1. **Claim extraction.** One Gemini call (`gemini-3.1-flash-lite-preview`) over the whole context window. Prompt asks for verbatim substrings only — no paraphrasing — returned as a JSON array.
2. **Per-claim verdict, in parallel.** For each extracted claim:
   - Tavily search (`search_depth='advanced'`) for supporting/contradicting evidence
   - Gemini prompt with `<CLAIM>` + `<CONTEXT>` (Tavily results) → JSON `{verdict, reasoning, sources}`
   - Verdict is one of `TRUE | FALSE | PARTIALLY TRUE | INCONCLUSIVE`
   - Sources clamped to 3 max

All errors caught and returned as a structured `status: "error"` row rather than raising, so partial failures don't poison the whole batch.

## Required env vars
- `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) — Gemini access for both extraction and verdict steps
- `TAVILY_API_KEY` — Tavily search

Read at pipeline-call time (not import time). Loaded via `dotenv` from `backend/.env.local` (and root `.env`).

## What works today
- STT → transcript publish → frontend live transcript rendering
- Context window accumulation
- Queue plumbing (verified independently in step 1 of the rebuild)
- Pipeline call with real verdicts — verified for *"The capital of Turkey is Berlin"* → `FALSE` with reasoning + Wikipedia + Britannica sources
- Worker resilience: one bad call doesn't kill the loop

## What doesn't work yet
- **Publishing verdicts back to the frontend.** The worker only logs results — it doesn't `publish_data(topic="flag")`. Frontend never sees real flags; previous demos used `mock_stream.py` for that. **This is the next step.**
- **Drain on disconnect.** When the user disconnects, `delete_room_on_close=True` tears down the room immediately and any in-flight pipeline calls get killed mid-flight.
- **Dedup / coalesce.** Every final transcript re-fact-checks the entire window. Same claim re-published on every utterance.

## Known issues
- **Spurious `CancelledError` on the first dispatched item.** The genai SDK's underlying httpx task gets cancelled by something in livekit's session startup. Worker swallows it (so it stays alive), but root cause not yet diagnosed. Self-test injection (version=-1) reliably hits this; real transcripts after the first one are fine.
- **Gemini model name `gemini-3.1-flash-lite-preview` is unusual.** Hasn't broken yet but worth verifying it's a real production model.

## How to verify locally
1. `cd backend && uv run python src/agent.py dev`
2. From `pixel-perfect-replication/`, run `npm run dev` and connect from the browser.
3. Watch the agent terminal. Within seconds of dispatch you should see:
   ```
   [worker] received version=-1 snapshot='The capital of France is Berlin.'
   [worker] calling pipeline version=-1
   ... google AFC ... google AFC ...
   [worker] pipeline returned version=-1 n_results=1
   [worker] pipeline result version=-1: [ ... verdict: "FALSE" ... ]
   ```
4. Speak a checkable claim. Within ~10s of the final transcript, expect another `[worker] pipeline result version=N` with a populated verdict.

If the version=-1 result is missing but later versions appear: the startup `CancelledError` swallowed it, which is expected behavior and not a regression.
