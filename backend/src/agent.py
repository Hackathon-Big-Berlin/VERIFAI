import asyncio
import json
import logging
from collections import deque

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    cli,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics, silero

logger = logging.getLogger("agent")
MAX_CONTEXT_WORDS = 500

load_dotenv(".env.local")

server = AgentServer()

@server.rtc_session(agent_name="my-agent")
async def my_agent(ctx: JobContext):
    # Logging setup
    # Add any other context you want in all log entries here
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    session = AgentSession(
        # Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand
        # See all available models at https://docs.livekit.io/agents/models/stt/
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
    )

    # TruWord delivery stream: forward every Deepgram transcript event to the
    # LiveKit Data Channel as JSON so the frontend can render it (and later we
    # can layer in fact-check verdicts on the same channel under a different topic).
    # Keep strong refs to in-flight publish tasks so they aren't GC'd before completing.
    pending_publishes: set[asyncio.Task] = set()
    # Sliding context window for downstream Gemini prompting.
    # This is intentionally plain text for now and only includes finalized STT chunks.
    context_words: deque[str] = deque(maxlen=MAX_CONTEXT_WORDS)
    context_window: str = ""

    def forward_transcript_to_data_channel(event):
        nonlocal context_window

        if event.is_final and event.transcript and event.transcript.strip():
            # Add new words and automatically evict oldest words once maxlen is reached.
            context_words.extend(event.transcript.strip().split())
            context_window = " ".join(context_words)
            logger.debug("updated context window words=%s", len(context_words))

        # session.on(...) callbacks are sync, but publish_data is async.
        # Schedule the publish on the running event loop so we don't block.
        payload = json.dumps(
            {
                "type": "transcript",
                "text": event.transcript,
                "is_final": event.is_final,
            }
        ).encode("utf-8")

        async def _publish():
            await ctx.room.local_participant.publish_data(
                payload, reliable=True, topic="transcript"
            )
            logger.info(
                "published transcript (final=%s): %s",
                event.is_final,
                event.transcript[:80],
            )

        task = asyncio.create_task(_publish())
        pending_publishes.add(task)
        task.add_done_callback(pending_publishes.discard)

    session.on("user_input_transcribed", forward_transcript_to_data_channel)

    # Join the room before starting the voice pipeline so the agent can receive
    # browser microphone audio and publish transcript events back to the frontend.
    await ctx.connect()

    # Start the session, which initializes the voice pipeline and warms up the models
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


if __name__ == "__main__":
    cli.run_app(server)
