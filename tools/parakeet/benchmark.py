"""Replay an authorized WAV through the real WS contract, at audio speed."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
import uuid
import wave

from websockets.asyncio.client import connect
from segmentation import MODEL
from auth import read_token


def words(text):
    # Case/punctuation only: numeral spelling is deliberately not made equivalent.
    return re.findall(r"[a-z0-9]+", text.casefold())


def word_errors(reference, hypothesis):
    expected, actual = words(reference), words(hypothesis)
    previous = list(range(len(actual) + 1))
    for index, token in enumerate(expected, 1):
        current = [index]
        for other, guess in enumerate(actual, 1):
            current.append(min(current[-1] + 1, previous[other] + 1,
                               previous[other - 1] + (token != guess)))
        previous = current
    return previous[-1], len(expected)


async def run(args, output):
    parsed = urlsplit(args.endpoint)
    if parsed.scheme != "ws" or parsed.hostname != "127.0.0.1" or parsed.path != "/v1/asr":
        raise ValueError("benchmark_requires_loopback")
    reference = args.reference.read_text()
    if len(reference) > 65_536:
        raise ValueError("reference_limit")
    with args.wav.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    with wave.open(str(args.wav), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError("expected_pcm16_mono_16000")
        duration = audio.getnframes() / 16000
        if not 0 < duration <= 300:
            raise ValueError("sample_duration_limit")
        task_id = str(uuid.uuid4())
        async with connect(args.endpoint, additional_headers={"Authorization": f"Bearer {read_token(args.token_file)}"},
                           max_size=65536, max_queue=4, compression=None, proxy=None) as ws:
            await ws.send(json.dumps({"header": {"action": "run-task", "task_id": task_id,
                                                "streaming": "duplex"}, "payload": {
                "task_group": "audio", "task": "asr", "function": "recognition", "model": MODEL,
                "parameters": {"format": "pcm", "sample_rate": 16000, "language_hints": ["en"]},
                "input": {}}}))
            ready = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if ready.get("header") != {"event": "task-started", "task_id": task_id}:
                raise ValueError("setup_failed")
            started = time.monotonic()
            sent = 0
            eof_at = None

            async def send():
                nonlocal sent, eof_at
                while pcm := audio.readframes(320):
                    await ws.send(pcm)
                    sent += len(pcm)
                    await asyncio.sleep(max(0, started + sent / 32000 - time.monotonic()))
                eof_at = time.monotonic()
                await ws.send(json.dumps({"header": {"action": "finish-task", "task_id": task_id},
                                          "payload": {"input": {}}}))

            sender = asyncio.create_task(send())
            first_draft = first_final = None
            finals, event_count, text_bytes = [], 0, 0
            final_ids = set()
            try:
                async with asyncio.timeout(duration + 30):
                    async for raw in ws:
                        event = json.loads(raw)
                        elapsed = (time.monotonic() - started) * 1000
                        if event["header"]["task_id"] != task_id:
                            raise ValueError("wrong_task")
                        kind = event["header"]["event"]
                        if kind == "task-failed":
                            raise ValueError("recognition_failed")
                        if kind == "task-finished":
                            break
                        sentence = event["payload"]["output"]["sentence"]
                        event_count += 1
                        text_bytes += len(sentence["text"].encode())
                        if event_count > 2000 or text_bytes > 1_048_576:
                            raise ValueError("evidence_limit")
                        output.write(json.dumps({"elapsed_ms": round(elapsed, 1), **sentence}, ensure_ascii=False) + "\n")
                        if sentence["text"]:
                            if sentence["sentence_end"]:
                                if sentence["sentence_id"] in final_ids:
                                    raise ValueError("duplicate_final")
                                final_ids.add(sentence["sentence_id"])
                                finals.append(sentence["text"])
                                if first_final is None:
                                    first_final = elapsed
                            elif first_draft is None:
                                first_draft = elapsed
                    else:
                        raise ValueError("missing_finished")
                await sender
            finally:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
            errors, count = word_errors(reference, " ".join(finals))
            result = {"event": "benchmark", "wav_sha256": digest, "audio_ms": round(duration * 1000, 1),
                      "pcm_bytes": sent, "events": event_count, "finals": len(finals),
                      "first_draft_ms": None if first_draft is None else round(first_draft, 1),
                      "first_final_ms": None if first_final is None else round(first_final, 1),
                      "eof_flush_ms": None if eof_at is None else round((time.monotonic() - eof_at) * 1000, 1),
                      "word_errors": errors, "reference_words": count,
                      "wer": errors / count if count else None,
                      "normalization": "casefold; [a-z0-9]+ tokens; numbers remain literal"}
            output.write(json.dumps(result) + "\n")
            print(json.dumps(result), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("--endpoint", default="ws://127.0.0.1:8767/v1/asr")
    parser.add_argument("--token-file", type=Path,
                        default=Path.home() / ".local/share/mimi-local-models/parakeet/bridge-token")
    parser.add_argument("--output", type=Path, required=True, help="new private JSONL outside Git")
    args = parser.parse_args()
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as evidence:
        asyncio.run(run(args, evidence))
