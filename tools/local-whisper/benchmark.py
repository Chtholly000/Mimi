#!/usr/bin/env python3
"""Explicit public-fixture replay; writes ASR text only to the requested private file."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import secrets
import time
import wave

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from bridge import Bridge, MODEL, Worker


def words(text):
    return re.findall(r"[a-z0-9]+", text.casefold())


def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for index, left in enumerate(reference, 1):
        current = [index]
        for right_index, right in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[right_index] + 1,
                               previous[right_index - 1] + (left != right)))
        previous = current
    return previous[-1]


async def replay(url, token, wav, reference, *, task_id="benchmark", language="en"):
    with wave.open(str(wav), "rb") as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
            raise ValueError("fixture_format_invalid")
        # Explicit bounded public test fixture, never a live capture or session recording.
        if audio.getnframes() > 16000 * 300:
            raise ValueError("fixture_too_long")
        pcm = audio.readframes(audio.getnframes())
    events = []
    async with connect(url, additional_headers={"Authorization": "Bearer " + token},
                       compression=None, max_size=131072) as ws:
        await ws.send(json.dumps({"header": {"action": "run-task", "task_id": task_id, "streaming": "duplex"},
                                 "payload": {"task_group": "audio", "task": "asr", "function": "recognition",
                                             "model": MODEL, "parameters": {"format": "pcm", "sample_rate": 16000,
                                                                             "language_hints": [language]}}}))
        if json.loads(await ws.recv())["header"]["event"] != "task-started":
            raise RuntimeError("task_not_started")
        began = time.perf_counter()
        finish_sent = None
        async def receive():
            async for raw in ws:
                value = json.loads(raw)
                name = value["header"]["event"]
                if name == "task-failed":
                    raise RuntimeError("recognition_failed")
                if name == "task-finished":
                    return
                if name == "result-generated":
                    events.append({"received_ms": (time.perf_counter() - began) * 1000,
                                   **value["payload"]["output"]["sentence"]})
        reader = asyncio.create_task(receive())
        try:
            for offset in range(0, len(pcm), 640):
                await asyncio.sleep(max(0, began + offset / 32000 - time.perf_counter()))
                await ws.send(pcm[offset:offset + 640])
                if reader.done():
                    reader.result()
                    raise RuntimeError("early_finish")
            await asyncio.sleep(max(0, began + len(pcm) / 32000 - time.perf_counter()))
            finish_sent = time.perf_counter()
            await ws.send(json.dumps({"header": {"action": "finish-task", "task_id": task_id, "streaming": "duplex"}}))
            await asyncio.wait_for(reader, 45)
        finally:
            if not reader.done():
                reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
        ended = time.perf_counter()
    finals = [event for event in events if event["sentence_end"]]
    drafts = [event for event in events if not event["sentence_end"]]
    recognized = " ".join(event["text"] for event in finals)
    expected = reference.read_text()
    ref_words = words(expected)
    errors = distance(ref_words, words(recognized))
    return {"sample": wav.name, "sha256": hashlib.sha256(wav.read_bytes()).hexdigest(),
            "audio_seconds": len(pcm) / 32000, "source_language": language,
            "first_draft_ms": drafts[0]["received_ms"] if drafts else None,
            "first_final_ms": finals[0]["received_ms"] if finals else None,
            "final_flush_ms": (ended - finish_sent) * 1000, "total_ms": (ended - began) * 1000,
            "drafts": len(drafts), "finals": len(finals), "word_errors": errors,
            "reference_words": len(ref_words), "wer": errors / len(ref_words) if ref_words else None,
            "events": events, "recognized": recognized, "reference": expected}


async def main(args):
    worker = Worker(args.root / "mimi-whisper-worker", args.root / "ggml-large-v3-turbo-q5_0.bin")
    rss = []
    sampler = None
    results = []
    try:
        await worker.start()
        async def sample():
            while True:
                proc = await asyncio.create_subprocess_exec("/bin/ps", "-p", str(worker.proc.pid),
                                                            "-o", "rss=", stdout=asyncio.subprocess.PIPE)
                output, _ = await proc.communicate()
                if output.strip():
                    rss.append(int(output.strip()))
                await asyncio.sleep(0.5)
        sampler = asyncio.create_task(sample())
        token = secrets.token_urlsafe(32)
        bridge = Bridge(worker, token)
        async with serve(bridge.handler, "127.0.0.1", 0, process_request=bridge.authenticate,
                         max_size=131072, max_queue=4, compression=None) as server:
            url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/asr"
            for wav, reference in args.case:
                result = await replay(url, token, Path(wav), Path(reference))
                results.append(result)
                print(json.dumps({key: value for key, value in result.items()
                                  if key not in ("events", "recognized", "reference")}), flush=True)
            if args.dual:
                wav, reference = map(Path, args.case[0])
                simultaneous = await asyncio.gather(
                    replay(url, token, wav, reference, task_id="system"),
                    replay(url, token, wav, reference, task_id="microphone"))
                for index, result in enumerate(simultaneous):
                    result["mode"] = "two simultaneous synthetic sources"
                    result["source"] = index
                results.extend(simultaneous)
    finally:
        if sampler:
            sampler.cancel()
            await asyncio.gather(sampler, return_exceptions=True)
        await worker.close()
    output = {"model": MODEL, "load_ms": worker.load_ms,
              "peak_worker_rss_mib_sampled": max(rss, default=0) / 1024,
              "child_maxrss_mib_macos": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1048576,
              "metric": "lowercase ASCII alphanumeric words; punctuation separates; numeric spelling unchanged",
              "timing": "1x real-time 20 ms PCM replay; first result measured from first PCM; flush after finish-task",
              "scope": "direct loopback bridge, no Mimi capture/overlay; explicit public-fixture output",
              "results": results}
    os.umask(0o077)
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with args.output.open("x") as stream:
        json.dump(output, stream, indent=2)
        stream.write("\n")
    print(json.dumps({key: value for key, value in output.items() if key != "results"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/mimi-local-models/whisper")
    parser.add_argument("--case", nargs=2, action="append", required=True, metavar=("WAV", "REFERENCE"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dual", action="store_true", help="Replay first fixture twice simultaneously; no capture")
    asyncio.run(main(parser.parse_args()))
