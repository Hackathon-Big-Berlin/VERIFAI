import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Literal

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
from livekit.plugins import ai_coustics, gradium, silero

from buffer import TranscriptBuffer
from debate_coach import generate_debate_reply
from fact_checker import fact_check_sentence

logger = logging.getLogger("agent")
ENABLE_DEBATE_COACH = os.getenv("ENABLE_DEBATE_COACH", "1") == "1"
DEBATE_SILENCE_SECONDS = 7
GRADIUM_API_KEY_ENV = "GRADIUM_API_KEY"


def configure_logging() -> None:
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
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
    )

    gradium_api_key = os.getenv(GRADIUM_API_KEY_ENV)
    if not gradium_api_key:
        logger.warning(
            "[%s] missing; Gradium TTS may fail to initialize",
            GRADIUM_API_KEY_ENV,
        )

    tts = gradium.TTS()
    audio_source = rtc.AudioSource(
        sample_rate=tts.sample_rate,
        num_channels=tts.num_channels,
    )
    audio_track = rtc.LocalAudioTrack.create_audio_track("debate_tts", audio_source)

    pending_publishes: set[asyncio.Task] = set()

    app_mode: Literal["normal", "interview", "debate"] = "normal"

    transcript_buffer = TranscriptBuffer()
    sentence_version = 0
    fact_check_queue: asyncio.Queue[tuple[int, str, str]] = asyncio.Queue()
    published_verdicts: dict[str, str] = {}

    debate_topic: str | None = None
    debate_history: list[dict[str, str]] = []
    debate_pending_finals: list[str] = []
    debate_turn_counter = 0
    debate_response_lock = asyncio.Lock()
    debate_silence_task: asyncio.Task | None = None

    def normalize_claim(text: str) -> str:
        return text.lower().strip(" \t\r\n.,!?;:'\"`-")

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
                logger.debug(
                    "[worker] full result version=%s: %s", version, json.dumps(result)
                )

                if result.get("status") != "success":
                    continue

                claim = result.get("claim", "")
                verdict = result.get("verdict", "")
                norm = normalize_claim(claim)
                if not norm:
                    continue
                if published_verdicts.get(norm) == verdict:
                    continue
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

                await ctx.room.local_participant.publish_data(
                    flag_payload, reliable=True, topic="flag"
                )
                logger.info(
                    "[worker] published flag verdict=%s claim=%r",
                    verdict,
                    claim[:80],
                )

                # Interview mode: speak a short alert when a claim is FALSE so
                # the interviewer hears it without watching the sidebar.
                if app_mode == "interview" and verdict == "FALSE":
                    reasoning_text = result.get("reasoning", "")
                    match = re.search(r"[^.!?]+[.!?]", reasoning_text)
                    first_sentence = match.group(0).strip() if match else reasoning_text
                    warning_text = f"Fact check alert: {first_sentence}"
                    try:
                        logger.info("[worker] synthesizing interview alert: %r", warning_text)
                        async for audio_event in tts.synthesize(warning_text):
                            await audio_source.capture_frame(audio_event.frame)
                    except Exception:
                        logger.exception("[worker] failed to synthesize interview alert")
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

    async def publish_debate_turn(
        role: Literal["user", "model"],
        text: str,
        sources: list[str] | None = None,
    ):
        nonlocal debate_turn_counter

        debate_turn_counter += 1
        turn_id = f"{role}-{debate_turn_counter}"
        timestamp = datetime.now(timezone.utc).isoformat()
        payload_data: dict[str, object] = {
            "type": "debate_turn",
            "role": role,
            "turnId": turn_id,
            "text": text,
            "timestamp": timestamp,
        }
        if sources:
            payload_data["sources"] = sources

        payload = json.dumps(payload_data).encode("utf-8")

        await ctx.room.local_participant.publish_data(payload, reliable=True, topic="debate")

    async def speak_debate_turn(text: str):
        if not text.strip():
            return
        try:
            async for audio_event in tts.synthesize(text):
                await audio_source.capture_frame(audio_event.frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[debate] failed speaking model turn")

    async def maybe_respond_to_debate_turn():
        nonlocal debate_topic

        if app_mode != "debate" or not debate_pending_finals:
            return
        if debate_response_lock.locked():
            return

        async with debate_response_lock:
            if app_mode != "debate" or not debate_pending_finals:
                return

            user_turn_text = " ".join(debate_pending_finals).strip()
            debate_pending_finals.clear()
            if not user_turn_text:
                return

            if debate_topic is None:
                # The user's first complete turn defines the debate topic.
                debate_topic = user_turn_text

            debate_history.append({"role": "user", "text": user_turn_text})
            debate_history[:] = debate_history[-12:]

            try:
                await publish_debate_turn("user", user_turn_text)
            except Exception:
                logger.exception("[debate] failed publishing user turn")
                return

            try:
                model_reply = await generate_debate_reply(
                    topic=debate_topic,
                    conversation=debate_history,
                    latest_user_turn=user_turn_text,
                )
            except Exception:
                logger.exception("[debate] failed generating model response")
                return

            model_text = str(model_reply.get("response_text", "")).strip()
            model_sources_raw = model_reply.get("sources", [])
            model_sources = (
                [str(url).strip() for url in model_sources_raw if str(url).strip()]
                if isinstance(model_sources_raw, list)
                else []
            )

            if not model_text:
                return

            debate_history.append({"role": "model", "text": model_text})
            debate_history[:] = debate_history[-12:]

            try:
                await publish_debate_turn("model", model_text, sources=model_sources)
            except Exception:
                logger.exception("[debate] failed publishing model turn")

            await speak_debate_turn(model_text)

    def schedule_debate_silence_timer():
        nonlocal debate_silence_task

        if not ENABLE_DEBATE_COACH or app_mode != "debate":
            return

        if debate_silence_task and not debate_silence_task.done():
            debate_silence_task.cancel()

        async def _wait_for_silence_and_respond():
            try:
                await asyncio.sleep(DEBATE_SILENCE_SECONDS)
                await maybe_respond_to_debate_turn()
            except asyncio.CancelledError:
                return

        debate_silence_task = asyncio.create_task(_wait_for_silence_and_respond())

    def handle_control_message(data_packet):
        nonlocal app_mode, debate_topic, debate_turn_counter

        if data_packet.topic != "control":
            return

        try:
            payload = json.loads(data_packet.data.decode("utf-8"))
        except Exception:
            logger.exception("[control] failed to parse control payload")
            return

        if not isinstance(payload, dict):
            return
        if payload.get("type") != "app_mode":
            return

        mode = payload.get("mode")
        if mode not in ("normal", "interview", "debate"):
            logger.warning("[control] unsupported mode: %r", mode)
            return
        if mode == app_mode:
            return

        app_mode = mode
        if app_mode == "debate":
            debate_topic = None
            debate_history.clear()
            debate_pending_finals.clear()
            debate_turn_counter = 0
        else:
            debate_pending_finals.clear()
            if debate_silence_task and not debate_silence_task.done():
                debate_silence_task.cancel()

        logger.info("[control] switched app mode to %s", app_mode)

    fact_check_worker_task = asyncio.create_task(fact_check_worker())
    ctx.room.on("data_received", handle_control_message)

    fact_check_queue.put_nowait((-1, "The capital of France is Berlin.", ""))

    def forward_transcript_to_data_channel(event):
        nonlocal sentence_version

        if event.transcript and event.transcript.strip() and app_mode == "debate":
            if event.is_final:
                debate_pending_finals.append(event.transcript.strip())
            # Any new transcript activity (interim or final) resets silence timer.
            schedule_debate_silence_timer()

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
        if debate_silence_task and not debate_silence_task.done():
            debate_silence_task.cancel()
            await asyncio.gather(debate_silence_task, return_exceptions=True)


if __name__ == "__main__":
    configure_logging()
    cli.run_app(server)
