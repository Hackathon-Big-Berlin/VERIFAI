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

from fact_checker import run_fact_check_pipeline

logger = logging.getLogger("agent")
MAX_CONTEXT_WORDS = 500


def configure_logging() -> None:
    # Ensure debug/info logs are visible during local dev runs.
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        force=True,
    )
    logger.debug("logging configured", extra={"level": "DEBUG"})

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
    context_version = 0
    fact_check_queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()

    # STEP 2 — run the real pipeline and log the structured result.
    # Still no publishing (that's step 3). Catches all exceptions so a
    # failing pipeline run never kills the loop.
    async def fact_check_worker():
        while True:
            version, context_snapshot = await fact_check_queue.get()
            try:
                logger.info(
                    "[worker] received version=%s snapshot=%r",
                    version,
                    context_snapshot[:120],
                )
                logger.info("[worker] calling pipeline version=%s", version)
                results = await run_fact_check_pipeline(context_snapshot)
                logger.info(
                    "[worker] pipeline returned version=%s n_results=%s",
                    version,
                    len(results),
                )
                logger.info(
                    "[worker] pipeline result version=%s:\n%s",
                    version,
                    json.dumps(results, indent=2),
                )
            except asyncio.CancelledError as e:
                # Diagnostic: a single bad Gemini call shouldn't kill the
                # worker forever. Log the underlying cause and keep looping
                # so subsequent queue items still get processed.
                logger.warning(
                    "[worker] cancellation received version=%s cause=%r — keeping worker alive",
                    version,
                    e.__cause__,
                )
            except Exception:
                logger.exception("[worker] failed version=%s", version)
            finally:
                fact_check_queue.task_done()

    fact_check_worker_task = asyncio.create_task(fact_check_worker())

    # STEP 2 self-test: a checkable false claim so we can see the full
    # pipeline (claim extraction → search → verdict) light up on dispatch
    # without depending on the user speaking.
    fact_check_queue.put_nowait((-1, "The capital of France is Berlin."))

    def forward_transcript_to_data_channel(event):
        nonlocal context_window, context_version

        if event.is_final and event.transcript and event.transcript.strip():
            # Add new words and automatically evict oldest words once maxlen is reached.
            context_words.extend(event.transcript.strip().split())
            context_window = " ".join(context_words)
            context_version += 1
            # N=1: run fact-check for every new final transcript chunk.
            fact_check_queue.put_nowait((context_version, context_window))
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

    try:
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
                        # QUAIL_VF_L  → best for single foreground speaker (your case)
                        # QUAIL_L     → better if you ever need multi-speaker / diarization
                        model=ai_coustics.EnhancerModel.QUAIL_VF_L,

                        # enhancement_level controls suppression aggressiveness:
                        #   0.5 = conservative — always preserves foreground speech, minimal artifacts
                        #   0.8 = balanced    — optimal WER on challenging real-world data (recommended)
                        #   1.0 = aggressive  — maximum suppression, risk of over-filtering quiet speech
                        model_parameters=ai_coustics.ModelParameters(enhancement_level=0.8),

                        # VAD settings tune how the model detects speech boundaries
                        vad_settings=ai_coustics.VadSettings(
                            # How long (seconds) to keep VAD "on" after speech ends — prevents clipping
                            # Range: 0.0–1.0s  |  Lower = tighter turn-taking, Higher = less cutoff
                            speech_hold_duration=0.03,

                            # How sensitive VAD is to speech vs noise
                            # Range: 1.0–15.0  |  Higher = more sensitive (catches whispers, but more false triggers)
                            sensitivity=6.0,

                            # Minimum duration (seconds) before a segment is treated as speech
                            # Range: 0.0–1.0s  |  Raise this to filter out very short utterances/clicks
                            minimum_speech_duration=0.0,
                        ),
                    ),
                ),
            ),
        )
    finally:
        fact_check_worker_task.cancel()
        await asyncio.gather(fact_check_worker_task, return_exceptions=True)


if __name__ == "__main__":
    configure_logging()
    cli.run_app(server)
