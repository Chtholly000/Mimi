"""Standalone local Parakeet file benchmark; no Mimi, capture or translation.

Inputs and output are private local evidence. Model/dependency installation is
documented by the existing tools/parakeet experiment. This runner never downloads.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import select
import signal
import subprocess
import sys
import time
import wave


def load_cases(args):
    cases = []
    if args.human_manifest:
        for line in args.human_manifest.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                cases.append({**row, "path": Path(row["audio_path"])})
    if args.tts_directory:
        manifest = json.loads((args.tts_directory / "manifest.json").read_text())
        for row in manifest["cases"]:
            cases.append({"id": row["id"], "split": "synthetic",
                          "path": args.tts_directory / row["wav"],
                          "reference": (args.tts_directory / row["reference"]).read_text(),
                          "sha256": row["sha256"]})
    if args.combined:
        audio_path = args.combined.resolve()
        directory = audio_path.parent
        entry = json.loads((directory / "manifest.json").read_text())["combined"]
        expected_audio = (directory / entry["wav"]).resolve()
        reference_path = (directory / entry["reference"]).resolve()
        if (expected_audio != audio_path or not expected_audio.is_relative_to(directory)
                or reference_path != audio_path.with_suffix(".txt")
                or not reference_path.is_relative_to(directory)):
            raise ValueError("combined_manifest_path_mismatch")
        if entry.get("reference_sha256") and hashlib.sha256(reference_path.read_bytes()).hexdigest() != entry["reference_sha256"]:
            raise ValueError("combined_reference_hash_mismatch")
        cases.append({"id": "english-24-continuous", "split": "continuous-file",
                      "path": audio_path, "reference": reference_path.read_text(),
                      "sha256": entry["sha256"]})
    cases.sort(key=lambda row: row["split"] != "synthetic")
    for row in cases:
        if hashlib.sha256(row["path"].read_bytes()).hexdigest() != row["sha256"]:
            raise ValueError("audio_hash_mismatch")
        with wave.open(str(row["path"])) as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
                raise ValueError("expected_pcm16_mono_16000")
            row["duration_s"] = wav.getnframes() / 16000
            if not 0 < row["duration_s"] <= 120:
                raise ValueError("audio_duration_limit")
            row["pcm"] = wav.readframes(wav.getnframes())
    for seconds in (3, 10):
        cases.append({"id": f"silence-{seconds}s", "split": "silence", "reference": "",
                      "duration_s": seconds, "pcm": bytes(seconds * 32000),
                      "sha256": hashlib.sha256(bytes(seconds * 32000)).hexdigest()})
    if len(cases) > 100:
        raise ValueError("case_count_limit")
    return cases


class RunCancelled(Exception):
    def __init__(self, signum):
        self.signum = signum


def cancel_owned_group(child):
    """Reap the worker and kill its descendants even after the leader exits."""
    def send(sig):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError:
            # Darwin may return EPERM for an already-exited zombie-only group.
            # Inspect IDs/state only; do not read unrelated process arguments.
            rows = subprocess.run(["ps", "-axo", "pgid=,stat="], check=True,
                                  capture_output=True, text=True, timeout=2).stdout
            if any(int(fields[0]) == child.pid and not fields[1].startswith("Z")
                   for line in rows.splitlines() if len(fields := line.split()) == 2):
                raise

    send(signal.SIGTERM)
    try:
        child.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass
    # The leader may have exited on TERM while a descendant ignored it.
    send(signal.SIGKILL)
    child.wait(timeout=2)


def supervise(command, load_timeout=180, clip_timeout=120):
    """An independent process enforces deadlines; progress has no ASR text."""
    def cancelled(signum, _frame):
        raise RunCancelled(signum)

    old_handlers = {sig: signal.signal(sig, cancelled) for sig in (signal.SIGINT, signal.SIGTERM)}
    reader, writer = os.pipe()
    child = None
    try:
        child = subprocess.Popen([*command, "--progress-fd", str(writer)],
                                 pass_fds=(writer,), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        os.close(writer)
        writer = None
        due = time.monotonic() + load_timeout
        pending = b""
        count = None
        completed = 0
        active = False
        while True:
            if time.monotonic() >= due:
                raise TimeoutError("worker_deadline")
            if b"\n" not in pending:
                readable, _, _ = select.select([reader], [], [], min(0.1, max(0, due - time.monotonic())))
                if not readable:
                    continue
                block = os.read(reader, 16384)
                if not block:
                    raise RuntimeError("worker_exited_before_done")
                pending += block
                if len(pending) > 65536:
                    raise ValueError("progress_limit")
                continue
            line, pending = pending.split(b"\n", 1)
            progress = json.loads(line)
            event = progress.get("event")
            if event == "loaded" and count is None:
                count = progress["cases"]
                if type(count) is not int or not 0 < count <= 100:
                    raise ValueError("invalid_case_count")
                due = time.monotonic() + clip_timeout
            elif event == "case_started" and count is not None and not active and completed < count:
                if progress["index"] != completed:
                    raise ValueError("unexpected_case_index")
                active = True
                due = time.monotonic() + clip_timeout
            elif event == "case_completed" and active:
                if progress["index"] != completed:
                    raise ValueError("unexpected_case_index")
                active = False
                completed += 1
                # Between clips, bound writing/teardown as well as decoding.
                due = time.monotonic() + clip_timeout
                print(json.dumps({key: progress[key] for key in ("id", "decode_s", "rtf")}), flush=True)
            elif event == "done" and count is not None and completed == count and not active:
                return child.wait(timeout=min(2, max(0.001, due - time.monotonic())))
            else:
                raise ValueError("invalid_progress_sequence")
    except (TimeoutError, subprocess.TimeoutExpired):
        print(json.dumps({"event": "error", "label": "worker_deadline"}), flush=True)
        return 124
    except RunCancelled as error:
        print(json.dumps({"event": "error", "label": "cancelled"}), flush=True)
        return 128 + error.signum
    except Exception as error:
        print(json.dumps({"event": "error", "label": type(error).__name__}), flush=True)
        return 1
    finally:
        # A repeated interrupt must not cut the owned-group cleanup short.
        for sig in old_handlers:
            signal.signal(sig, signal.SIG_IGN)
        try:
            if child is not None:
                cancel_owned_group(child)
        finally:
            os.close(reader)
            if writer is not None:
                os.close(writer)
            for sig, handler in old_handlers.items():
                signal.signal(sig, handler)


def worker(args):
    progress = os.fdopen(args.progress_fd, "w", buffering=1)

    def notify(value):
        progress.write(json.dumps(value) + "\n")
        progress.flush()

    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        raise ValueError("evidence_must_stay_outside_repository")
    os.umask(0o077)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    cases = load_cases(args)
    model_manifest = json.loads((args.model / "mimi-manifest.json").read_text())
    for filename, expected in model_manifest["sha256"].items():
        with (args.model / filename).open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != expected:
                raise ValueError("model_hash_mismatch")
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as output:
        def write(row):
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
            output.flush()

        started = time.perf_counter()
        import mlx.core as mx
        import numpy as np
        from parakeet_mlx import from_pretrained
        from parakeet_mlx.audio import get_logmel
        mx.set_cache_limit(256 * 1024 * 1024)
        mx.random.seed(0)
        model = from_pretrained(str(args.model.resolve(strict=True)))
        mx.eval(model.parameters())
        write({"event": "loaded", "model": "parakeet-tdt-0.6b-v3",
               "model_manifest": model_manifest,
               "python": platform.python_version(),
               "runtime": importlib.metadata.version("parakeet-mlx"),
               "mlx": importlib.metadata.version("mlx"),
               "load_s": time.perf_counter() - started,
               "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
               "method": "direct generate; greedy; PCM float32; 30s nonoverlapping chunks only above 30s; no warmup",
               "cache_limit_bytes": 256 * 1024 * 1024})
        notify({"event": "loaded", "cases": len(cases)})
        for index, row in enumerate(cases):
            notify({"event": "case_started", "index": index})
            started = time.perf_counter()
            texts, chunks = [], []
            for offset in range(0, len(row["pcm"]), 30 * 32000):
                part = row["pcm"][offset:offset + 30 * 32000]
                audio = mx.array(np.frombuffer(part, dtype="<i2").astype(np.float32) / 32768.0)
                chunk_start = time.perf_counter()
                text = model.generate(get_logmel(audio, model.preprocessor_config))[0].text.strip()
                if len(text.encode("utf-8")) > 32768:
                    raise ValueError("result_size_limit")
                chunks.append({"offset_s": offset / 32000, "duration_s": len(part) / 32000,
                               "decode_s": time.perf_counter() - chunk_start})
                texts.append(text)
            elapsed = time.perf_counter() - started
            write({"event": "result", "id": row["id"], "split": row["split"],
                   "sha256": row["sha256"], "duration_s": row["duration_s"],
                   "reference": row["reference"], "hypothesis": " ".join(texts),
                   "decode_s": elapsed, "rtf": elapsed / row["duration_s"],
                   "first_after_load": index == 0, "chunks": chunks,
                   "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                   "mlx_peak_bytes": mx.get_peak_memory()})
            notify({"event": "case_completed", "index": index, "id": row["id"],
                    "decode_s": round(elapsed, 3), "rtf": round(elapsed / row["duration_s"], 3)})
    notify({"event": "done"})
    progress.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--human-manifest", type=Path)
    parser.add_argument("--tts-directory", type=Path)
    parser.add_argument("--combined", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--progress-fd", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        if args.progress_fd is None:
            parser.error("worker requires supervisor progress pipe")
        return worker(args)
    return supervise([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], "--worker"])


if __name__ == "__main__":
    raise SystemExit(main())
