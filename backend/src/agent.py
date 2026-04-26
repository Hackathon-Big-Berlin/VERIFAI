import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Literal

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, inference, room_io
from livekit.plugins import ai_coustics, gradium

from buffer import TranscriptBuffer
from debate_coach import compute_final_score, evaluate_user_turn_coaching, generate_debate_reply
from fact_checker import fact_check_sentence

logger = logging.getLogger("agent")
ENABLE_DEBATE_COACH = os.getenv("ENABLE_DEBATE_COACH", "1") == "1"
DEBATE_SILENCE_SECONDS = 7
GRADIUM_API_KEY_ENV = "GRADIUM_API_KEY"

load_dotenv(".env.local")

server = AgentServer()


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        force=True,
    )
    logger.debug("logging configured", extra={"level": "DEBUG"})


def build_room_options() -> room_io.RoomOptions:
    return room_io.RoomOptions(
        delete_room_on_close=True,
        audio_input=room_io.AudioInputOptions(
            noise_cancellation=ai_coustics.audio_enhancement(
                model=ai_coustics.EnhancerModel.QUAIL_VF_L,
                model_parameters=ai_coustics.ModelParameters(enhancement_level=0.8),
                vad_settings=ai_coustics.VadSettings(
                    speech_hold_duration=0.03,
                    sensitivity=6.0,
                    minimum_speech_duration=0.0,
                ),
            ),
        ),
    )


@server.rtc_session(agent_name="my-agent")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
    )

    if not os.getenv(GRADIUM_API_KEY_ENV):
        logger.warning("[%s] missing; Gradium TTS may fail to initialize", GRADIUM_API_KEY_ENV)

    tts = gradium.TTS()
    audio_source = rtc.AudioSource(sample_rate=tts.sample_rate, num_channels=tts.num_channels)
    audio_track = rtc.LocalAudioTrack.create_audio_track("debate_tts", audio_source)

    pending_publishes: set[asyncio.Task] = set()
    pending_fact_checks: set[asyncio.Task] = set()
    app_mode: Literal["normal", "interview", "debate"] = "normal"
    transcript_buffer = TranscriptBuffer()
    sentence_version = 0
    published_verdicts: dict[str, str] = {}

    debate_topic: str | None = None
    debate_history: list[dict[str, str]] = []
    debate_full_history: list[dict[str, str]] = []
    debate_user_turn_records: list[dict[str, str]] = []
    debate_pending_finals: list[str] = []
    debate_turn_counter = 0
    debate_response_lock = asyncio.Lock()
    debate_silence_task: asyncio.Task | None = None
    debate_post_analysis_task: asyncio.Task | None = None

    def normalize_claim(text: str) -> str:
        return text.lower().strip(" \t\r\n.,!?;:'\"`-")

    def split_claim_sentences(text: str) -> list[str]:
        chunks = re.split(r"(?<=[.!?])\s+", text.strip())
        return [chunk.strip() for chunk in chunks if chunk.strip()]

    async def process_fact_check(version: int, sentence: str, history: str) -> None:
        try:
            logger.info("[worker] received version=%s sentence=%r history_len=%s", version, sentence[:120], len(history))
            result = await fact_check_sentence(sentence, history)
            logger.info("[worker] result version=%s status=%s verdict=%s", version, result.get("status"), result.get("verdict"))
            logger.debug("[worker] full result version=%s: %s", version, json.dumps(result))

            if result.get("status") != "success":
                return

            claim = str(result.get("claim", ""))
            verdict = str(result.get("verdict", ""))
            norm = normalize_claim(claim)
            if not norm:
                return
            if published_verdicts.get(norm) == verdict:
                return
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

            await ctx.room.local_participant.publish_data(flag_payload, reliable=True, topic="flag")
            logger.info("[worker] published flag verdict=%s claim=%r", verdict, claim[:80])

            if app_mode == "interview" and verdict == "FALSE":
                reasoning_text = str(result.get("reasoning", ""))
                match = re.search(r"[^.!?]+[.!?]", reasoning_text)
                first_sentence = match.group(0).strip() if match else reasoning_text
                warning_text = f"Fact check alert: {first_sentence}"
                try:
                    logger.info("[worker] synthesizing interview alert: %r", warning_text)
                    async for audio_event in tts.synthesize(warning_text):
                        await audio_source.capture_frame(audio_event.frame)
                except Exception:
                    logger.exception("[worker] failed to synthesize interview alert")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[worker] failed version=%s", version)

    async def publish_debate_turn(role: Literal["user", "model"], text: str, sources: list[str] | None = None) -> str:
        nonlocal debate_turn_counter

        debate_turn_counter += 1
        turn_id = f"{role}-{debate_turn_counter}"
        payload_data: dict[str, object] = {
            "type": "debate_turn",
            "role": role,
            "turnId": turn_id,
            "text": text,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if sources:
            payload_data["sources"] = sources

        await ctx.room.local_participant.publish_data(
            json.dumps(payload_data).encode("utf-8"),
            reliable=True,
            topic="debate",
        )
        return turn_id

    async def publish_debate_score(turn_id: str, score_payload: dict[str, object]) -> None:
        payload = {"type": "debate_score", "turnId": turn_id, **score_payload}
        await ctx.room.local_participant.publish_data(json.dumps(payload).encode("utf-8"), reliable=True, topic="debate")

    async def publish_debate_final_score(final_payload: dict[str, object]) -> None:
        payload = {"type": "debate_final_score", **final_payload}
        await ctx.room.local_participant.publish_data(json.dumps(payload).encode("utf-8"), reliable=True, topic="debate")

    async def speak_debate_turn(text: str) -> None:
        if not text.strip():
            return
        try:
            async for audio_event in tts.synthesize(text):
                await audio_source.capture_frame(audio_event.frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[debate] failed speaking model turn")

    async def build_claim_checks_for_turn(user_turn_text: str) -> list[dict[str, object]]:
        checks: list[dict[str, object]] = []
        claim_history = ""
        for sentence in split_claim_sentences(user_turn_text)[:8]:
            result = await fact_check_sentence(sentence, claim_history)
            claim_history = f"{claim_history} {sentence}".strip()
            if result.get("status") != "success":
                continue
            sources = result.get("sources", [])
            checks.append(
                {
                    "claim": str(result.get("claim", sentence)).strip(),
                    "verdict": str(result.get("verdict", "INCONCLUSIVE")).strip(),
                    "reasoning": str(result.get("reasoning", "")).strip(),
                    "sources": [str(url) for url in sources if isinstance(url, str)][:3],
                }
            )
        return checks

    async def run_post_debate_analysis() -> None:
        nonlocal debate_post_analysis_task

        if not debate_user_turn_records:
            final_payload = compute_final_score([])
            final_payload["summary"] = (
                "No completed user turns were available for post-debate analysis. "
                "Make sure to speak a full turn and pause before pressing Stop debate."
            )
            final_payload["topWeaknesses"] = []
            final_payload["nextSteps"] = [
                "Speak a complete claim before stopping so the coach can analyze it.",
                "Use one concrete fact or source per turn to improve evidence quality.",
            ]
            try:
                await publish_debate_final_score(final_payload)
            except Exception:
                logger.exception("[debate] failed publishing empty final debate score")
            return

        topic = debate_topic or "General debate topic"
        score_rows: list[dict[str, int]] = []
        weakness_notes: list[str] = []
        next_steps: list[str] = []
        total_fallacies = 0

        for record in debate_user_turn_records:
            turn_id = str(record.get("turn_id", "")).strip()
            user_turn_text = str(record.get("text", "")).strip()
            if not turn_id or not user_turn_text:
                continue

            try:
                claim_checks = await build_claim_checks_for_turn(user_turn_text)
            except Exception:
                logger.exception("[debate] claim-check analysis failed for %s", turn_id)
                claim_checks = []

            try:
                coaching_payload = await evaluate_user_turn_coaching(
                    topic=topic,
                    user_turn=user_turn_text,
                    conversation=debate_full_history,
                    claim_checks=claim_checks,
                )
            except Exception:
                logger.exception("[debate] coaching analysis failed for %s", turn_id)
                continue

            scores = coaching_payload.get("scores", {})
            if isinstance(scores, dict):
                score_rows.append(
                    {
                        "logicalConsistency": int(scores.get("logicalConsistency", 0)),
                        "evidenceQuality": int(scores.get("evidenceQuality", 0)),
                        "rebuttalEffectiveness": int(scores.get("rebuttalEffectiveness", 0)),
                        "clarityStructure": int(scores.get("clarityStructure", 0)),
                        "responsiveness": int(scores.get("responsiveness", 0)),
                    }
                )

            logical_fallacies = coaching_payload.get("logicalFallacies", [])
            if isinstance(logical_fallacies, list):
                total_fallacies += len(logical_fallacies)
                for item in logical_fallacies[:2]:
                    if isinstance(item, dict):
                        fallacy_name = str(item.get("fallacy", "")).strip()
                        if fallacy_name:
                            weakness_notes.append(fallacy_name)

            suggestion = str(coaching_payload.get("coachingSuggestion", "")).strip()
            if suggestion:
                next_steps.append(suggestion)

            payload = {
                "scores": coaching_payload.get("scores", {}),
                "strongClaims": coaching_payload.get("strongClaims", []),
                "weakClaims": coaching_payload.get("weakClaims", []),
                "logicalFallacies": coaching_payload.get("logicalFallacies", []),
                "argumentImpact": coaching_payload.get("argumentImpact", ""),
                "coachingSuggestion": coaching_payload.get("coachingSuggestion", ""),
                "claimChecks": claim_checks,
            }
            try:
                await publish_debate_score(turn_id, payload)
            except Exception:
                logger.exception("[debate] failed publishing debate_score for %s", turn_id)

        final_payload = compute_final_score(score_rows)
        final_payload["summary"] = (
            f"{final_payload.get('summary', '')} Post-analysis detected {total_fallacies} reasoning issue"
            f"{'s' if total_fallacies != 1 else ''} across user turns."
        ).strip()
        final_payload["topWeaknesses"] = weakness_notes[:5]
        final_payload["nextSteps"] = next_steps[:5]

        try:
            await publish_debate_final_score(final_payload)
        except Exception:
            logger.exception("[debate] failed publishing final debate score")

    async def maybe_respond_to_debate_turn() -> None:
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
                debate_topic = user_turn_text

            debate_history.append({"role": "user", "text": user_turn_text})
            debate_history[:] = debate_history[-12:]
            debate_full_history.append({"role": "user", "text": user_turn_text})

            try:
                user_turn_id = await publish_debate_turn("user", user_turn_text)
            except Exception:
                logger.exception("[debate] failed publishing user turn")
                return

            debate_user_turn_records.append({"turn_id": user_turn_id, "text": user_turn_text})

            try:
                model_reply = await generate_debate_reply(
                    topic=debate_topic,
                    conversation=debate_history,
                    latest_user_turn=user_turn_text,
                )
            except Exception:
                logger.exception("[debate] failed generating model response")
                return

            if isinstance(model_reply, dict):
                model_text = str(model_reply.get("response_text", "")).strip()
                model_sources_raw = model_reply.get("sources", [])
                model_sources = [str(url).strip() for url in model_sources_raw if isinstance(url, str) and url.strip()]
            else:
                model_text = str(model_reply).strip()
                model_sources = []

            if not model_text:
                return

            debate_history.append({"role": "model", "text": model_text})
            debate_history[:] = debate_history[-12:]
            debate_full_history.append({"role": "model", "text": model_text})

            try:
                await publish_debate_turn("model", model_text, sources=model_sources)
            except Exception:
                logger.exception("[debate] failed publishing model turn")

            await speak_debate_turn(model_text)

    def schedule_debate_silence_timer() -> None:
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

    def handle_control_message(data_packet) -> None:
        nonlocal app_mode, debate_topic, debate_turn_counter, debate_post_analysis_task

        if data_packet.topic != "control":
            return

        try:
            payload = json.loads(data_packet.data.decode("utf-8"))
        except Exception:
            logger.exception("[control] failed to parse control payload")
            return

        if not isinstance(payload, dict) or payload.get("type") != "app_mode":
            return

        mode = payload.get("mode")
        if mode not in ("normal", "interview", "debate"):
            logger.warning("[control] unsupported mode: %r", mode)
            return
        if mode == app_mode:
            return

        was_debate = app_mode == "debate"
        app_mode = mode

        if app_mode == "debate":
            debate_topic = None
            debate_history.clear()
            debate_full_history.clear()
            debate_user_turn_records.clear()
            debate_pending_finals.clear()
            debate_turn_counter = 0
            if debate_silence_task and not debate_silence_task.done():
                debate_silence_task.cancel()
        else:
            debate_pending_finals.clear()
            if debate_silence_task and not debate_silence_task.done():
                debate_silence_task.cancel()
            if was_debate:
                if debate_post_analysis_task and not debate_post_analysis_task.done():
                    debate_post_analysis_task.cancel()
                debate_post_analysis_task = asyncio.create_task(run_post_debate_analysis())

        logger.info("[control] switched app mode to %s", app_mode)

    def forward_transcript_to_data_channel(event) -> None:
        nonlocal sentence_version

        if event.transcript and event.transcript.strip() and app_mode == "debate":
            if event.is_final:
                debate_pending_finals.append(event.transcript.strip())
            schedule_debate_silence_timer()

        if event.is_final and event.transcript and event.transcript.strip():
            for sentence, history in transcript_buffer.process_chunk(event.transcript):
                sentence_version += 1
                logger.debug("[buffer] queued sentence v=%s text=%r history_len=%s", sentence_version, sentence[:80], len(history))
                task = asyncio.create_task(process_fact_check(sentence_version, sentence, history))
                pending_fact_checks.add(task)
                task.add_done_callback(pending_fact_checks.discard)

        payload = json.dumps(
            {
                "type": "transcript",
                "text": event.transcript,
                "is_final": event.is_final,
            }
        ).encode("utf-8")

        async def _publish():
            await ctx.room.local_participant.publish_data(payload, reliable=True, topic="transcript")
            logger.info("published transcript (final=%s): %s", event.is_final, event.transcript[:80])

        task = asyncio.create_task(_publish())
        pending_publishes.add(task)
        task.add_done_callback(pending_publishes.discard)

    ctx.room.on("data_received", handle_control_message)
    session.on("user_input_transcribed", forward_transcript_to_data_channel)

    try:
        await ctx.connect()

        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await ctx.room.local_participant.publish_track(audio_track, options)

        await session.start(
            agent=Agent(instructions="Transcribe user speech. Do not respond."),
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=room_io.AudioInputOptions(
                    noise_cancellation=ai_coustics.audio_enhancement(
                        # QUAIL_VF_L  -> best for single foreground speaker (your case)
                        # QUAIL_L     -> better if you ever need multi-speaker / diarization
                        model=ai_coustics.EnhancerModel.QUAIL_VF_L,
                        # enhancement_level controls suppression aggressiveness:
                        #   0.5 = conservative - always preserves foreground speech, minimal artifacts
                        #   0.8 = balanced    - optimal WER on challenging real-world data (recommended)
                        #   1.0 = aggressive  - maximum suppression, risk of over-filtering quiet speech
                        model_parameters=ai_coustics.ModelParameters(enhancement_level=0.8),
                        # VAD settings tune how the model detects speech boundaries:
                        vad_settings=ai_coustics.VadSettings(
                            # How long (seconds) to keep VAD "on" after speech ends; prevents clipping.
                            # Range: 0.0-1.0s | Lower = tighter turn-taking, Higher = less cutoff
                            speech_hold_duration=0.03,
                            # How sensitive VAD is to speech vs noise.
                            # Range: 1.0-15.0 | Higher = more sensitive (catches whispers, but more false triggers)
                            sensitivity=6.0,
                            # Minimum duration (seconds) before a segment is treated as speech.
                            # Range: 0.0-1.0s | Raise to filter out very short utterances/clicks
                            minimum_speech_duration=0.01,
                        ),
                    ),
                ),
            ),
        )
    finally:
        for task in list(pending_fact_checks):
            task.cancel()
        if pending_fact_checks:
            await asyncio.gather(*pending_fact_checks, return_exceptions=True)
        if debate_silence_task and not debate_silence_task.done():
            debate_silence_task.cancel()
            await asyncio.gather(debate_silence_task, return_exceptions=True)
        if debate_post_analysis_task and not debate_post_analysis_task.done():
            debate_post_analysis_task.cancel()
            await asyncio.gather(debate_post_analysis_task, return_exceptions=True)


if __name__ == "__main__":
    configure_logging()
    cli.run_app(server)
