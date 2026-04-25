# Plan for Max — TruWord delivery stream + silencing the agent

## 1. The full pipeline (what the data does)

```
[browser mic]
     │  WebRTC (LiveKit room "truword")
     ▼
[LiveKit room]  ◀── room created from token w/ roomConfig.agents=[my-agent]
     │
     ▼
[your AgentSession in backend/src/agent.py]
     │  audio → ai_coustics noise cancel → Deepgram STT (LiveKit Inference)
     │  emits `user_input_transcribed` events ({ transcript, is_final })
     ▼
[Boris's hook — added between session creation and session.start]
     │  json.dumps({type:"transcript", text, is_final})
     ▼
[ctx.room.local_participant.publish_data(payload, topic="transcript", reliable=True)]
     │  WebRTC data channel
     ▼
[frontend src/hooks/useLiveKitRoom.ts]
     │  RoomEvent.DataReceived → JSON.parse → React state
     ▼
[src/pages/Index.tsx → <TranscriptPanel />]
```

## 2. What changed in `backend/src/agent.py`

**Additive only** — no logic in your STT/LLM/TTS pipeline was touched. The new block lives after `session = AgentSession(...)` and before `await session.start(...)`:

```python
def forward_transcript_to_data_channel(event):
    payload = json.dumps({
        "type": "transcript",
        "text": event.transcript,
        "is_final": event.is_final,
    }).encode("utf-8")

    async def _publish():
        await ctx.room.local_participant.publish_data(
            payload, reliable=True, topic="transcript"
        )

    task = asyncio.create_task(_publish())
    pending_publishes.add(task)
    task.add_done_callback(pending_publishes.discard)

session.on("user_input_transcribed", forward_transcript_to_data_channel)
```

The `pending_publishes` set keeps strong refs to in-flight tasks (otherwise the GC eats them mid-await — ruff RUF006).

## 3. Data channel contract

| Topic | Producer | JSON shape |
|---|---|---|
| `transcript` | this agent | `{ "type":"transcript", "text": str, "is_final": bool }` |
| `flag` (future) | Lukas | `{ "type":"flag", "sentence":..., "verdict":..., "reason":..., "source":... }` |

Frontend dispatches by `message.type` — anyone publishing JSON with a recognised `type` gets rendered. **Don't break this shape without telling Boris + Lukas.**

## 4. Token + dispatch — current dev setup

- `.env` (root, gitignored) holds both `LIVEKIT_*` for backend and `VITE_LIVEKIT_*` for frontend.
- The dev token was minted via:
  ```
  lk token create --identity boris --room truword --valid-for 24h --join --agent my-agent
  ```
  The `--agent my-agent` embeds `roomConfig.agents = [{agentName:"my-agent"}]`, so the agent auto-dispatches **on room creation**. If the room already exists (e.g., you're reconnecting), run `lk room delete truword` once or `lk dispatch create --agent-name my-agent --room truword` to force the dispatch.

## 5. The decision that's yours: silencing the agent

Right now the agent is the **voice assistant starter** — it has LLM (`gpt-5.3-chat-latest`) + TTS (`cartesia/sonic-3`) + turn detection + preemptive generation. For TruWord (passive listening) we don't want the agent to talk back.

LiveKit has a recipe for exactly this: [`/reference/recipes/transcriber/`](https://docs.livekit.io/reference/recipes/transcriber/) — STT-only AgentSession.

**Three changes to `agent.py`:**

### a) Drop LLM/TTS/turn-detection from the session

```python
# before
session = AgentSession(
    stt=inference.STT(model="deepgram/nova-3", language="multi"),
    llm=inference.LLM(model=AGENT_MODEL),
    tts=inference.TTS(model="cartesia/sonic-3", voice="..."),
    turn_detection=MultilingualModel(),
    vad=ctx.proc.userdata["vad"],
    preemptive_generation=True,
)

# after
session = AgentSession(
    stt=inference.STT(model="deepgram/nova-3", language="multi"),
    vad=ctx.proc.userdata["vad"],
)
```

### b) Replace the `Assistant` class with a plain `Agent`

```python
await session.start(
    agent=Agent(instructions="Transcribe user speech. Do not respond."),
    room=ctx.room,
    room_options=room_io.RoomOptions(
        audio_input=room_io.AudioInputOptions(
            noise_cancellation=ai_coustics.audio_enhancement(
                model=ai_coustics.EnhancerModel.QUAIL_VF_L
            ),
        ),
    ),
)
```

### c) Drop now-unused imports

- `MultilingualModel`
- `AGENT_MODEL` constant (was the LLM model id)
- The realtime model commentary block

> **Note:** Boris's `forward_transcript_to_data_channel` hook keeps working unchanged — `user_input_transcribed` fires from the STT layer, independent of the LLM/TTS path.

## 6. Verification after Max's change

- `uv run python src/agent.py console` — speak; you see Deepgram log lines but **no spoken reply** and no `published transcript` flicker from preemptive replies.
- Frontend Connect → speak → transcripts still appear in `TranscriptPanel`.
