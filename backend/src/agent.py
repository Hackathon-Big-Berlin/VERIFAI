import asyncio
import json
import logging

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

from buffer import TranscriptBuffer
from context_loader import parse_context_text
from fact_checker import fact_check_sentence

logger = logging.getLogger("agent")


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

    # Strong refs to in-flight transcript-publish tasks so they aren't GC'd
    # mid-await (ruff RUF006).
    pending_publishes: set[asyncio.Task] = set()
    # Sentence buffer that emits complete sentences (with recent-sentence
    # history for pronoun resolution) as STT finals arrive.
    transcript_buffer = TranscriptBuffer()
    sentence_version = 0
    # Queue items: (version, sentence, history). One sentence per fact-check.
    fact_check_queue: asyncio.Queue[tuple[int, str, str]] = asyncio.Queue()
    # User-uploaded trusted context (gospel/nuanced). Mutated by the
    # data_received handler when the frontend sends a "context" payload.
    # Wrapped in a dict so the worker closure picks up live updates.
    context_state: dict[str, str] = {"text": ""}
    # Dedup key = normalized claim (lowercased, stripped of punctuation/space).
    # Maps to the last verdict we published for that claim; we only re-publish
    # when the verdict changes, and the frontend replaces the existing card.
    # Matches the frontend's normalizeClaim() exactly.
    published_verdicts: dict[str, str] = {}

    def normalize_claim(text: str) -> str:
        return text.lower().strip(" \t\r\n.,!?;:'\"`-")

    # Run the pipeline on each completed sentence and publish successful,
    # novel verdicts to the data channel as topic="flag".
    async def fact_check_worker():
        while True:
            version, sentence, history = await fact_check_queue.get()
            try:
                trusted_context = context_state["text"]
                logger.info(
                    "[worker] received version=%s sentence=%r history_len=%s trusted_len=%s",
                    version,
                    sentence[:120],
                    len(history),
                    len(trusted_context),
                )
                result = await fact_check_sentence(sentence, history, trusted_context)
                logger.info(
                    "[worker] result version=%s status=%s verdict=%s",
                    version,
                    result.get("status"),
                    result.get("verdict"),
                )
                logger.debug("[worker] full result version=%s: %s", version, json.dumps(result))

                if result.get("status") != "success":
                    continue
                claim = result.get("claim", "")
                verdict = result.get("verdict", "")
                norm = normalize_claim(claim)
                if not norm:
                    continue
                if published_verdicts.get(norm) == verdict:
                    continue  # same claim, same verdict — already shown
                published_verdicts[norm] = verdict

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

    # Self-test: a checkable false claim so we can see the pipeline light up
    # on dispatch without depending on the user speaking. History is empty
    # because there's no prior context.
    fact_check_queue.put_nowait((-1, "The capital of France is Berlin.", ""))

    def forward_transcript_to_data_channel(event):
        nonlocal sentence_version

        if event.is_final and event.transcript and event.transcript.strip():
            # Feed the buffer; it returns any complete sentences with their
            # recent-sentence history. Often zero (chunk didn't end with .!?)
            # or one; occasionally more if the chunk contains multiple sentences.
            for sentence, history in transcript_buffer.process_chunk(event.transcript):
                sentence_version += 1
                fact_check_queue.put_nowait((sentence_version, sentence, history))
                logger.debug(
                    "[buffer] queued sentence v=%s text=%r history_len=%s",
                    sentence_version,
                    sentence[:80],
                    len(history),
                )

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

    async def publish_context_status(phase: str, kept: int = 0, total: int = 0, error: str | None = None) -> None:
        payload: dict = {"type": "context_status", "phase": phase, "kept": kept, "total": total}
        if error:
            payload["error"] = error
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps(payload).encode("utf-8"),
                reliable=True,
                topic="context_status",
            )
            logger.info("[context] status -> %s kept=%s total=%s", phase, kept, total)
        except Exception:
            logger.exception("[context] failed to publish status")

    async def handle_context_upload(mode: str, statements: list[str]) -> None:
        if mode == "gospel":
            context_state["text"] = "\n".join(statements)
            logger.info("[context] gospel mode: %s statements stored", len(statements))
            await publish_context_status("ready", kept=len(statements), total=len(statements))
        else:
            # Nuanced vetting lands in the next commit. For now, accept it
            # but treat it like gospel so the upload path works end-to-end.
            context_state["text"] = "\n".join(statements)
            logger.info(
                "[context] nuanced mode placeholder (vetting not implemented yet): %s statements stored",
                len(statements),
            )
            await publish_context_status("ready", kept=len(statements), total=len(statements))

    def on_data_received(packet) -> None:
        if packet.topic != "context":
            return
        try:
            payload = json.loads(packet.data.decode("utf-8"))
        except Exception:
            logger.exception("[context] failed to parse incoming payload")
            return
        if payload.get("type") != "context":
            return
        mode = payload.get("mode")
        statements_field = payload.get("statements")
        if mode not in ("gospel", "nuanced") or not isinstance(statements_field, list):
            logger.warning("[context] invalid payload shape: %r", payload)
            return
        # Tolerate either a list of strings or a raw text blob via "text".
        statements = [s.strip() for s in statements_field if isinstance(s, str) and s.strip()]
        if not statements and isinstance(payload.get("text"), str):
            statements = parse_context_text(payload["text"])
        if not statements:
            logger.warning("[context] upload had no usable statements")
            return
        # Schedule the async handler; data_received callback is sync.
        task = asyncio.create_task(handle_context_upload(mode, statements))
        pending_publishes.add(task)
        task.add_done_callback(pending_publishes.discard)

    try:
        # Join the room before starting the voice pipeline so the agent can receive
        # browser microphone audio and publish transcript events back to the frontend.
        await ctx.connect()
        # Subscribe to data-channel messages from the participant — used for
        # user-uploaded trusted context.
        ctx.room.on("data_received", on_data_received)

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
