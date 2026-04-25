# Transcript data flow — where the text lives and how to consume it

## Where the text lives in the Python process

```
[browser mic]
   ↓ WebRTC audio
[LiveKit room]
   ↓ audio track
[agent.py: AgentSession.stt = inference.STT(deepgram/nova-3)]
   ↓ STT runs server-side, emits events
session.emit("user_input_transcribed", event)
              event.transcript   ← the actual string
              event.is_final     ← bool
```

**The single source of truth is the `user_input_transcribed` event on the `session` object.** The text exists **only** in that event payload — once the handler returns, it's gone unless someone stores it. Whoever wants the text has to attach a listener.

## Right now, only one listener is attached

In `agent.py` there's exactly one consumer:

```python
def forward_transcript_to_data_channel(event):
    # Publishes JSON to the LiveKit data channel for the frontend
    ...

session.on("user_input_transcribed", forward_transcript_to_data_channel)
```

That hook serializes the event to JSON (`{type, text, is_final}`) and pushes it via `ctx.room.local_participant.publish_data(..., topic="transcript")` — that's how the frontend gets it. **Nothing else inside Python touches the transcript.**

## How Lukas (or any backend consumer) should hook in

`session.on(...)` is **fan-out** — multiple listeners can attach. Add a second listener right next to the existing one in `agent.py`:

```python
from src.fact_checker import run_fact_check_pipeline

# Buffer that accumulates final-only transcripts until we have enough text
# to run a meaningful claim extraction.
transcript_buffer: list[str] = []
SENTENCE_THRESHOLD = 3  # run fact-check every 3 finalized utterances, tune as needed

def collect_for_fact_check(event):
    if not event.is_final:
        return  # ignore interim per project.md "Buffer Strategy"

    transcript_buffer.append(event.transcript)
    if len(transcript_buffer) < SENTENCE_THRESHOLD:
        return

    # Drain the buffer atomically before kicking off the async pipeline
    text_block = " ".join(transcript_buffer)
    transcript_buffer.clear()

    async def _check_and_publish():
        results = await run_fact_check_pipeline(text_block)
        for res in results:
            if res.get("status") != "success":
                continue
            payload = json.dumps({
                "type": "flag",
                "sentence": res["claim"],
                "verdict": res["verdict"],
                "reason": res["reasoning"],
                "source": res["sources"][0] if res["sources"] else "",
            }).encode("utf-8")
            await ctx.room.local_participant.publish_data(
                payload, reliable=True, topic="flag"
            )

    task = asyncio.create_task(_check_and_publish())
    pending_publishes.add(task)
    task.add_done_callback(pending_publishes.discard)

session.on("user_input_transcribed", collect_for_fact_check)
```

Both listeners run independently:
- Boris's `forward_transcript_to_data_channel` → frontend renders text live
- Lukas's `collect_for_fact_check` → buffers → Gemini/Tavily → publishes flags → frontend `DataReceived` handler picks them up by `message.type === "flag"`

## The data channel as a bus

| Topic | Producer | JSON | Consumer |
|---|---|---|---|
| `transcript` | Boris's listener | `{type:"transcript", text, is_final}` | Frontend `<TranscriptPanel>` |
| `flag` | Lukas's listener (TBD) | `{type:"flag", sentence, verdict, reason, source}` | Frontend `<FactCheckSidebar>` |

The frontend hook (`useLiveKitRoom.ts`) already discriminates on `message.type`, so when Lukas's flag payloads start arriving they'll route to the sidebar without any frontend change needed (just wire `<FactCheckSidebar>` to the same data — currently it still uses mock data; trivial fix).

## Short version

The text exists as an event inside the Python `AgentSession`. Anyone on the backend who wants it adds another `session.on("user_input_transcribed", ...)` handler. The data channel is just the broadcast bus to the frontend.
