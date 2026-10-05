#!/usr/bin/env python3
"""Standalone Qwen ASR: public file input, no Mimi/MT/capture/network listener.

The parent process owns the deadline/cancellation boundary. The model process
loads only one selected local model and checkpoints explicit private results.
"""

import argparse
import dataclasses
from datetime import datetime, timezone
import fcntl
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time
import wave

from common import DEFAULT_CACHE, HERE, literal_tokens, load_cases, private_json, score, sha256, verify


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def signal_group(pid, signum):
    try:
        os.killpg(pid, signum)
    except ProcessLookupError:
        pass


def supervise(argv, deadline, lifecycle=None):
    child = subprocess.Popen([sys.executable, __file__, *argv, "--worker"], start_new_session=True)
    if lifecycle is not None:
        lifecycle.update(supervisor_pid=os.getpid(), worker_pid=child.pid, started_utc=utc_now())
    try:
        code = child.wait(timeout=deadline)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        started = time.perf_counter()
        signal_group(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            signal_group(child.pid, signal.SIGKILL)
            child.wait()
        print(json.dumps({"status": "cancelled", "reaped": True,
                          "cancel_ms": (time.perf_counter() - started) * 1000}), flush=True)
        code = 124
    finally:
        # A leader can exit on TERM before an owned descendant does. Reap the
        # entire newly created process group, even after the leader is gone.
        signal_group(child.pid, signal.SIGKILL)
    if lifecycle is not None:
        lifecycle.update(ended_utc=utc_now(), exit_code=code, worker_reaped=True)
    return code


def worker(args):
    if args.output.exists():
        raise ValueError("output_already_exists")
    cases = load_cases(args.manifest, combined=args.combined)
    assets = json.loads((HERE / "assets.json").read_text())
    selected = assets["models"][args.model]
    model_path = args.cache / "models" / selected["repo"].split("/")[-1]
    for item in selected["files"]:
        verify(model_path / item["name"], item["sha256"], item["bytes"])
    source = args.cache / ("mlx-qwen3-asr-" + assets["runtime"]["revision"])
    verify(args.cache / "mlx-qwen3-asr-source.tar.gz", assets["runtime"]["archive_sha256"])
    # The extracted runtime is verified separately by prepare.py's tree manifest.
    for name, expected in assets["runtime"]["tree_sha256"].items():
        verify(source / name, expected)
    normalizer = args.cache / "normalizer"
    for name, expected in assets["normalizer"]["files"].items():
        verify(normalizer / "whisper_normalizers" / name, expected)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    sys.path[:0] = [str(source), str(normalizer)]
    import mlx.core as mx
    import numpy as np
    from mlx_qwen3_asr import load_model, transcribe
    from mlx_qwen3_asr.streaming import feed_audio, finish_streaming, init_streaming, streaming_metrics
    from whisper_normalizers import EnglishTextNormalizer

    mx.random.seed(0)
    normalize = EnglishTextNormalizer()
    started = time.perf_counter()
    model, _ = load_model(str(model_path), dtype=mx.float16)
    mx.eval(model.parameters())
    load_ms = (time.perf_counter() - started) * 1000
    result = {"model": selected["repo"], "model_revision": selected["revision"],
              "runtime_revision": assets["runtime"]["revision"],
              "normalizer_revision": assets["normalizer"]["revision"],
              "runner_sha256": sha256(__file__), "mode": args.mode,
              "load_ms": load_ms, "settings": {"dtype": "float16", "language": "English",
              "temperature": 0, "seed": 0, "context": "", "max_new_tokens": 512,
              "stream_chunk_s": 2, "stream_context_s": 30, "feed_frame_ms": 20},
              "versions": {p: importlib.metadata.version(p) for p in ("mlx", "mlx-metal", "numpy", "regex", "huggingface-hub")},
              "cases": []}
    private_json(args.output, result)
    print(json.dumps({"status": "loaded", "model": args.model, "load_ms": load_ms}), flush=True)
    if args.silence:
        cases.append({"id": "silence-10s", "split": "silence", "duration_s": 10,
                      "reference_text": "", "sha256": None})
    for index, case in enumerate(cases):
        if "wav" in case:
            with wave.open(case["wav"], "rb") as wav:
                pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768
        else:
            pcm = np.zeros(160000, dtype=np.float32)
        events = []
        started = time.perf_counter()
        if args.mode == "offline":
            def progress(event):
                events.append({**event, "elapsed_ms": (time.perf_counter() - started) * 1000})
            output = transcribe(pcm, model=model, language="English", context="", dtype=mx.float16,
                                max_new_tokens=512, return_chunks=True, verbose=False, on_progress=progress)
            details = dataclasses.asdict(output)
            hypothesis = output.text
            first = next((e["elapsed_ms"] for e in events if e["event"] == "chunk_completed"), None)
            timing = {"first_completed_chunk_ms": first, "first_token_ms": None, "eof_flush_ms": None}
        else:
            state = init_streaming(model=str(model_path), language="English", context="", dtype=mx.float16,
                                   chunk_size_sec=2, max_context_sec=30, max_new_tokens=512,
                                   finalization_mode="accuracy", endpointing_mode="fixed")
            first = None
            max_lag_ms = 0.0
            max_feed_ms = 0.0
            previous = ""
            for offset in range(0, len(pcm), 320):
                due = started + min(offset + 320, len(pcm)) / 16000
                time.sleep(max(0, due - time.perf_counter()))
                before = time.perf_counter()
                feed_audio(pcm[offset:offset + 320], state, model=model)
                now = time.perf_counter()
                max_feed_ms = max(max_feed_ms, (now - before) * 1000)
                max_lag_ms = max(max_lag_ms, (now - due) * 1000)
                if state.text != previous:
                    if first is None and state.text.strip():
                        first = (now - started) * 1000
                    events.append({"event": "text_update", "elapsed_ms": (now - started) * 1000,
                                   "audio_received_s": min(offset + 320, len(pcm)) / 16000,
                                   "text": state.text, "stable_text": state.stable_text})
                    previous = state.text
            eof = time.perf_counter()
            finish_streaming(state, model=model)
            timing = {"first_text_update_ms": first, "eof_flush_ms": (time.perf_counter() - eof) * 1000,
                      "max_delivery_lag_ms": max_lag_ms, "max_feed_call_ms": max_feed_ms,
                      "first_token_ms": None}
            hypothesis = state.text
            details = {"streaming_metrics": streaming_metrics(state)}
        elapsed = time.perf_counter() - started
        item = {"id": case["id"], "split": case["split"], "speaker_id": case.get("speaker_id"),
                "audio_sha256": case["sha256"], "duration_s": case["duration_s"],
                "reference": case["reference_text"], "hypothesis": hypothesis,
                "literal": score(literal_tokens(case["reference_text"]), literal_tokens(hypothesis)),
                "whisper_normalized": score(normalize(case["reference_text"]).split(), normalize(hypothesis).split()),
                "elapsed_s": elapsed, "rtf": elapsed / case["duration_s"], **timing,
                "details": details, "events": events, "process_peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "mlx_peak_memory_bytes": mx.get_peak_memory()}
        result["cases"].append(item)
        private_json(args.output, result)
        print(json.dumps({"status": "case_completed", "index": index + 1, "id": case["id"],
                          "elapsed_s": elapsed, "literal": item["literal"],
                          "whisper_normalized": item["whisper_normalized"]}), flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("0.6B", "1.7B"), required=True)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--manifest", action="append", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mode", choices=("offline", "paced-audio"), default="offline")
    parser.add_argument("--combined", action="store_true")
    parser.add_argument("--silence", action="store_true")
    parser.add_argument("--deadline", type=float, default=1800)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 0 < args.deadline <= 3600:
        parser.error("deadline must be in (0, 3600]")
    if args.worker:
        return worker(args)
    if args.output.exists() or args.output.with_suffix(".lifecycle.json").exists():
        raise ValueError("output_or_lifecycle_already_exists")
    def terminate(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    args.cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Hold this across model verification, inference, cancellation and reaping.
    # An accidental second launch must fail instead of distorting measurements.
    with (args.cache / "benchmark.lock").open("a") as lock:
        os.fchmod(lock.fileno(), 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "busy", "models_loaded": False}), file=sys.stderr)
            return 2
        lifecycle = {"model": args.model, "mode": args.mode}
        code = supervise(sys.argv[1:], args.deadline, lifecycle)
    lifecycle["lock_released_utc"] = utc_now()
    private_json(args.output.with_suffix(".lifecycle.json"), lifecycle)
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Detailed failures can contain paths/content; keep terminal diagnostics sanitized.
        print(json.dumps({"status": "failed", "error_type": type(error).__name__}), file=sys.stderr)
        sys.exit(1)
