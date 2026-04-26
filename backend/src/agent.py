import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Literal
import re

from dotenv import load_dotenv
from livekit import rtc
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
from livekit.plugins import ai_coustics, gradium, silero

from buffer import TranscriptBuffer
from debate_coach import generate_debate_reply
from debate_coach import generate_debate_reply
from fact_checker import fact_check_sentence

logger = logging.getLogger("agent")
ENABLE_DEBATE_COACH = os.getenv("ENABLE_DEBATE_COACH", "1") == "1"
DEBATE_SILENCE_SECONDS = 7
GRADIUM_API_KEY_ENV = "GRADIUM_API_KEY"
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

load_dotenv()

def get_room_options(adaptation_mode: str) -> room_io.RoomOptions:
    """
    Generates the ai-coustics audio configuration based on the requested adaptation mode.
    Defaults to 'focus' if an unknown mode is provided.
    """
    # Baseline: Noisy outdoor environment (Focus Mode)
    model = ai_coustics.EnhancerModel.QUAIL_VF_L
    enhancement_level = 0.65
    speech_hold_duration = 0.05
    sensitivity = 5.0
    minimum_speech_duration = 0.03

    if adaptation_mode == "multispeaker":
        # Multi-speaker outdoor (Debate)
        model = ai_coustics.EnhancerModel.QUAIL_L
        enhancement_level = 0.65
        
    elif adaptation_mode == "studio":
        # Quiet indoor (Studio)
        model = ai_coustics.EnhancerModel.QUAIL_L
        enhancement_level = 0.5
        sensitivity = 6.0  # More sensitive to catch soft natural speech
        
    logger.info("[adaptation] ⚙️ Building config for mode: %s (model=%s, enhancement=%s)", 
                adaptation_mode, model.name, enhancement_level)

    return room_io.RoomOptions(
        delete_room_on_close=True,
        audio_input=room_io.AudioInputOptions(
            noise_cancellation=ai_coustics.audio_enhancement(
                model=model,
                model_parameters=ai_coustics.ModelParameters(enhancement_level=enhancement_level),
                vad_settings=ai_coustics.VadSettings(
                    speech_hold_duration=speech_hold_duration,
                    sensitivity=sensitivity,
                    minimum_speech_duration=minimum_speech_duration,
                ),
            ),
        ),
    )

server = AgentServer()



@server.rtc_session(agent_name="my-agent")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    # Asynchronous state management for adaptation modes
    current_adaptation_mode = "focus"
    mode_changed_event = asyncio.Event()

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
                    "[worker] received version=%s sentence=%r history_len=%s",
                    version,
                    sentence[:120],
                    len(history),
                )
                result = await fact_check_sentence(sentence, history)
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


    # Helper functions moved up so they can be referenced by the event loop.
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
            return

        # Nuanced: run each statement through the pipeline standalone, in
        # parallel, and keep everything except FALSE verdicts (and crashes).
        total = len(statements)
        await publish_context_status("vetting", kept=0, total=total)

        survivors: list[str] = []
        # `as_completed` lets us push progress as each fact-check finishes,
        # rather than waiting for the slowest one.
        coros = [fact_check_sentence(stmt, "", "") for stmt in statements]
        for fut in asyncio.as_completed(coros):
            try:
                result = await fut
            except Exception:
                logger.exception("[context] vetting task crashed")
                await publish_context_status("vetting", kept=len(survivors), total=total)
                continue

            status = result.get("status")
            verdict = result.get("verdict")
            original = result.get("claim", "")

            if status == "success" and verdict == "FALSE":
                logger.info("[context] vetting filtered FALSE: %s", original[:80])
            elif status == "error":
                logger.warning("[context] vetting error for: %s", original[:80])
            else:
                # Keep TRUE, PARTIALLY TRUE, INCONCLUSIVE, and skipped.
                survivors.append(original)

            await publish_context_status("vetting", kept=len(survivors), total=total)

        context_state["text"] = "\n".join(survivors)
        logger.info(
            "[context] nuanced vetting complete: %s/%s survived",
            len(survivors),
            total,
        )
        await publish_context_status("ready", kept=len(survivors), total=total)

    def on_data_received(packet) -> None:
        nonlocal current_adaptation_mode 

        # 1. Decode the packet first so we can route based on the JSON payload
        try:
            payload = json.loads(packet.data.decode("utf-8"))
        except Exception:
            if packet.topic == "context":
                logger.exception("[context] failed to parse incoming payload")
            return

        # 2. Handle audio adaptation mode switch
        if "adaptation" in payload:
            new_mode = payload.get("adaptation")
            logger.info("[adaptation] 🔄 Received adaptation mode switch request: %s", new_mode)
            
            # Trigger the restart loop if the mode is actually different
            if new_mode and new_mode != current_adaptation_mode:
                current_adaptation_mode = new_mode
                logger.info("[adaptation] ⚡ Signaling session restart...")
                mode_changed_event.set()
            return

        # [DELETED]: Redundant JSON parsing logic that was causing crashes.
        if packet.topic == "context":
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

        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await ctx.room.local_participant.publish_track(audio_track, options)

        # [NEW] The Session Restart Loop
        while True:
            mode_changed_event.clear()
            logger.info("[adaptation] 🚀 Initializing session for mode: %s", current_adaptation_mode)

            session = AgentSession(
                stt=inference.STT(model="deepgram/nova-3", language="multi"),
            )
            session.on("user_input_transcribed", forward_transcript_to_data_channel)

            options = get_room_options(current_adaptation_mode)

            await session.start(
                agent=Agent(instructions="Transcribe user speech. Do not respond."),
                room=ctx.room,
                room_options=options,
            )
            
            await mode_changed_event.wait()
            
            logger.info("[adaptation] 🛑 Mode change requested. Tearing down current session...")
            
            if hasattr(session, 'aclose'):
                await session.aclose()
            elif hasattr(session, 'shutdown'):
                await session.shutdown()

    except asyncio.CancelledError:
        logger.info("Agent session cancelled normally.")
    except Exception:
        logger.exception("Agent session failed")
    finally:
        # [MODIFIED]: Consolidated the fact_check_worker cancellation into the primary teardown block.
        fact_check_worker_task.cancel()
        await asyncio.gather(fact_check_worker_task, return_exceptions=True)
        if debate_silence_task and not debate_silence_task.done():
            debate_silence_task.cancel()
            await asyncio.gather(debate_silence_task, return_exceptions=True)
        if debate_silence_task and not debate_silence_task.done():
            debate_silence_task.cancel()
            await asyncio.gather(debate_silence_task, return_exceptions=True)


if __name__ == "__main__":
    configure_logging()
    cli.run_app(server)