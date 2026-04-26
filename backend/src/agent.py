import asyncio
import json
import logging
import re

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
from context_loader import context_likely_relevant, parse_context_text
from fact_checker import fact_check_sentence

logger = logging.getLogger("agent")


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
                    continue  
                
                published_verdicts[norm] = verdict

                flag_payload = json.dumps(
                    {
                        "type": "flag",
                        "claim": claim,
                        "verdict": verdict,
                        "reasoning": result.get("reasoning", ""),
                        "sources": result.get("sources", []),
                        "used_trusted_context": context_likely_relevant(claim, trusted_context),
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

                if verdict == "FALSE":
                    reasoning_text = result.get('reasoning', '')
                    
                    # Regex to extract the first sentence (stops at the first period, exclamation, or question mark)
                    match = re.search(r'[^.!?]+[.!?]', reasoning_text)
                    first_sentence = match.group(0).strip() if match else reasoning_text

                    warning_text = f"Fact check alert: {first_sentence}"
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
        await ctx.connect()
        
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await ctx.room.local_participant.publish_track(audio_track, options)

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
                        # QUAIL_VF_L  → best for single foreground speaker (our case)
                        # QUAIL_L     → better if you ever need multi-speaker / diarization
                        model=ai_coustics.EnhancerModel.QUAIL_VF_L,

                        # enhancement_level controls suppression aggressiveness:
                        #   0.5 = conservative — always preserves foreground speech, minimal artifacts
                        #   0.8 = balanced    — optimal WER on challenging real-world data (recommended)
                        #   1.0 = aggressive  — maximum suppression, risk of over-filtering quiet speech
                        model_parameters=ai_coustics.ModelParameters(enhancement_level=0.8),

                        # VAD settings tune how the model detects speech boundaries.
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