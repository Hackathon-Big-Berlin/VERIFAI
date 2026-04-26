import asyncio
import json
import logging

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    cli,
    inference,
    room_io,
)
from livekit.plugins import ai_coustics, silero, gradium

from buffer import TranscriptBuffer
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
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    session = AgentSession(
        # Speech-to-text (STT) is your agent's ears, turning the user's speech into text
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
    )

    # Initialize Gradium TTS and LiveKit Audio infrastructure for Live Reporter Mode
    tts = gradium.TTS()
    audio_source = rtc.AudioSource(
        sample_rate=tts.sample_rate, 
        num_channels=tts.num_channels
    )
    audio_track = rtc.LocalAudioTrack.create_audio_track("reporter_tts", audio_source)

    pending_publishes: set[asyncio.Task] = set()
    transcript_buffer = TranscriptBuffer()
    sentence_version = 0
    fact_check_queue: asyncio.Queue[tuple[int, str, str]] = asyncio.Queue()
    published_verdicts: dict[str, str] = {}

    def normalize_claim(text: str) -> str:
        return text.lower().strip(" \t\r\n.,!?;:'\"`-")

    # Run the pipeline on each completed sentence and publish successful,
    # novel verdicts to the data channel. If FALSE, trigger Gradium TTS alert.
    async def fact_check_worker():
        while True:
            version, sentence, history = await fact_check_queue.get()
            try:
                logger.info(
                    "[worker] received version=%s sentence=%r history_len=%s",
                    version,
                    sentence[:120],
                    len(history),
                )
                result = await fact_check_sentence(sentence, history)
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

                # 1. Publish Data Channel Flag to Frontend
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

                # 2. Live Reporter Mode - Voice Notification via Gradium
                if verdict == "FALSE":
                    warning_text = f"Fact check alert: {result.get('reasoning', '')}"
                    try:
                        logger.info("[worker] Synthesizing audio alert: %r", warning_text)
                        async for audio_event in tts.synthesize(warning_text):
                            await audio_source.capture_frame(audio_event.frame)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        logger.exception("[worker] failed to play TTS alert")

            except asyncio.CancelledError as e:
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
    fact_check_queue.put_nowait((-1, "The capital of France is Berlin.", ""))

    def forward_transcript_to_data_channel(event):
        nonlocal sentence_version

        if event.is_final and event.transcript and event.transcript.strip():
            for sentence, history in transcript_buffer.process_chunk(event.transcript):
                sentence_version += 1
                fact_check_queue.put_nowait((sentence_version, sentence, history))
                logger.debug(
                    "[buffer] queued sentence v=%s text=%r history_len=%s",
                    sentence_version,
                    sentence[:80],
                    len(history),
                )

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
        await ctx.connect()
        
        # Publish our standalone TTS track so the room can hear the reporter alerts
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await ctx.room.local_participant.publish_track(audio_track, options)

        await session.start(
                agent=Agent(instructions="Transcribe user speech. Do not respond."),
                room=ctx.room,
                room_options=room_io.RoomOptions(
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