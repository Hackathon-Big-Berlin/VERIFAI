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

import mock_stream

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
    # Dedup key = "claim|verdict". Same shape as the frontend's dedup so we
    # don't even bother sending repeats — the rolling context window means the
    # pipeline re-extracts the same claim on every final transcript.
    published_claims: set[str] = set()

    # STEP 3 — run the pipeline and publish each successful, novel verdict
    # to the data channel as topic="flag". Frontend's useLiveKitRoom hook
    # picks these up and routes them into the side panel + transcript.
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

                for result in results:
                    if result.get("status") != "success":
                        continue
                    claim = result.get("claim", "")
                    verdict = result.get("verdict", "")
                    key = f"{claim}|{verdict}"
                    if key in published_claims:
                        continue
                    published_claims.add(key)

                    flag_payload = json.dumps(
                        {
                            "type": "flag",
                            "claim": claim,
                            "verdict": verdict,
                            "reasoning": result.get("reasoning", ""),
                            "sources": result.get("sources", []),
                        }
                    ).encode("utf-8")

                    try:
                        await ctx.room.local_participant.publish_data(
                            flag_payload, reliable=True, topic="flag"
                        )
                        logger.info(
                            "[worker] published flag verdict=%s claim=%r",
                            verdict,
                            claim[:80],
                        )
                    except Exception:
                        logger.exception(
                            "[worker] failed to publish flag claim=%r",
                            claim[:80],
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

        #Mock Fact Check StreamL
        # We now dispatch that external function as a background task.
        mock_task = asyncio.create_task(mock_stream.start_mock_fact_check_stream(ctx, logger))
        
        # Store a strong reference to prevent Python's garbage collector from destroying it
        pending_publishes.add(mock_task)
        mock_task.add_done_callback(pending_publishes.discard)
        # -------------------------------------
        # Start the session, which initializes the voice pipeline and warms up the models
        await session.start(
                agent=Agent(instructions="Transcribe user speech. Do not respond."),
                room=ctx.room,
                room_options=room_io.RoomOptions(
                    # Tear down the room when the user disconnects so the next
                    # Connect creates a fresh room and re-triggers agent dispatch
                    # (rooms otherwise linger ~5min on LiveKit Cloud and reconnecting
                    # joins the existing room without dispatching the agent).
                    delete_room_on_close=True,
                    audio_input=room_io.AudioInputOptions(
                        noise_cancellation=ai_coustics.audio_enhancement(
                            model=ai_coustics.EnhancerModel.QUAIL_VF_L
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
