#!/usr/bin/env python3
"""Isolated local ASR file benchmark. Audio/transcripts stay outside the repository."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import select
import signal
import subprocess
import sys
import time
import wave

ROOT = Path.home() / ".local/share/mimi-local-models/funasr"
TOKENIZER = r"[a-z0-9]+"


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            value.update(block)
    return value.hexdigest()


def score(reference, hypothesis):
    """Literal case-insensitive English WER; no number/spelling normalization."""
    ref = re.findall(TOKENIZER, reference.casefold())
    hyp = re.findall(TOKENIZER, hypothesis.casefold())
    return token_score(ref, hyp)


def token_score(ref, hyp):
    prev = list(range(len(hyp) + 1))
    for i, token in enumerate(ref, 1):
        row = [i]
        for j, candidate in enumerate(hyp, 1):
            row.append(min(prev[j] + 1, row[-1] + 1, prev[j - 1] + (token != candidate)))
        prev = row
    return {"errors": prev[-1], "reference_words": len(ref), "hypothesis_words": len(hyp),
            "wer": prev[-1] / len(ref) if ref else None}


def wav_info(path):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (1, 2, 16000, "NONE"):
            raise ValueError("requires_pcm16_mono_16khz")
        frames = audio.getnframes()
    if not 0 < frames <= 16000 * 600:
        raise ValueError("audio_duration_out_of_range")
    return frames


def read_cases(manifest_path, combined=False):
    manifest_path = manifest_path.resolve()
    inline = manifest_path.suffix == ".jsonl"
    if inline:
        if combined:
            raise ValueError("combined_requires_json_manifest")
        items = [json.loads(line) for line in manifest_path.read_text().splitlines() if line.strip()]
    else:
        data = json.loads(manifest_path.read_text())
        items = [{"id": data["id"] + "-combined", **data["combined"]}] if combined else data.get("cases", [data])
    if not 0 < len(items) <= 1000:
        raise ValueError("invalid_case_count")
    cases, ids = [], set()
    for item in items:
        if item["id"] in ids:
            raise ValueError("duplicate_case_id")
        ids.add(item["id"])
        audio = (manifest_path.parent / item["audio_path" if inline else "wav"]).resolve()
        if not inline and not audio.is_relative_to(manifest_path.parent):
            raise ValueError("sample_outside_manifest_directory")
        # The common corpus JSONL permits absolute local audio paths, never URLs.
        audio_hash = digest(audio)
        if item.get("sha256") != audio_hash:
            raise ValueError("audio_hash_mismatch")
        if inline:
            reference = item["reference"].strip()
            reference_hash = hashlib.sha256(reference.encode()).hexdigest()
        else:
            ref_path = (manifest_path.parent / item["reference"]).resolve()
            if not ref_path.is_relative_to(manifest_path.parent):
                raise ValueError("reference_outside_manifest_directory")
            reference = ref_path.read_text().strip()
            reference_hash = digest(ref_path)
            if item.get("reference_sha256") and item["reference_sha256"] != reference_hash:
                raise ValueError("reference_hash_mismatch")
        cases.append({"id": item["id"], "wav": str(audio), "reference_text": reference,
                      "sha256": audio_hash, "reference_sha256": reference_hash,
                      "frames": wav_info(audio), "tag": item.get("tag", item.get("split", "unspecified")),
                      "speaker_id": item.get("speaker_id")})
    return cases


def chunks(frames, seconds=30):
    width = seconds * 16000
    return [(start, min(frames, start + width)) for start in range(0, frames, width)]


def verify_model(root, name):
    spec = json.loads(Path(__file__).with_name("models.json").read_text())[name]
    target = root / "models" / name
    verified = json.loads((target / "verified.json").read_text())
    if verified["revision"] != spec["revision"] or verified["repo"] != spec["repo"]:
        raise ValueError("model_revision_mismatch")
    for filename in spec["files"]:
        file = target / filename
        entry = verified["files"][filename]
        if file.stat().st_size != entry["size"] or digest(file) != spec["sha256"][filename] or entry["sha256"] != spec["sha256"][filename]:
            raise ValueError("model_hash_mismatch")
    return target, verified


@contextlib.contextmanager
def quiet_libraries():
    """Library progress and any accidental transcript prints never become logs."""
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(1), os.dup(2)]
    try:
        with open(os.devnull, "w") as sink:
            os.dup2(sink.fileno(), 1)
            os.dup2(sink.fileno(), 2)
        yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        for fd, previous in zip((1, 2), saved):
            os.dup2(previous, fd)
            os.close(previous)


def worker(args):
    started = time.monotonic()
    with quiet_libraries():
        import numpy as np
        import torch
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        if args.device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("mps_unavailable")
        target = args.root / "models" / args.model
        if args.model == "sensevoice":
            from funasr import AutoModel
            model = AutoModel(model=str(target), device=args.device, ncpu=4,
                              disable_update=True, disable_pbar=True, disable_log=True,
                              trust_remote_code=False, hub="hf")
            actual_device = str(next(model.model.parameters()).device)
        else:
            from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
            processor = AutoProcessor.from_pretrained(target, local_files_only=True, trust_remote_code=False)
            model = AutoModelForSpeechSeq2Seq.from_pretrained(
                target, local_files_only=True, trust_remote_code=False, dtype=torch.float32,
            ).to(args.device).eval()
            actual_device = str(next(model.parameters()).device)
        if not actual_device.startswith(args.device):
            raise RuntimeError("unexpected_device_fallback")
        if args.device == "mps":
            torch.mps.synchronize()
    print(json.dumps({"event": "ready", "load_seconds": time.monotonic() - started,
                      "actual_device": actual_device, "dtype": "float32", "threads": 4}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        started = time.monotonic()
        try:
            with quiet_libraries():
                with wave.open(request["wav"], "rb") as audio:
                    audio.setpos(request["start"])
                    pcm = audio.readframes(request["end"] - request["start"])
                    if len(pcm) != (request["end"] - request["start"]) * 2:
                        raise ValueError("truncated_pcm")
                    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
                    del pcm
                with torch.inference_mode():
                    if args.model == "sensevoice":
                        result = model.generate(input=samples, cache={}, language="en", use_itn=True,
                                                batch_size=1, disable_pbar=True)
                        text = re.sub(r"<\|[^|]*\|>", "", result[0]["text"]).strip()
                        reached_eos = None
                    else:
                        inputs = processor.apply_transcription_request(
                            audio=samples, language="en",
                            processor_kwargs={"return_tensors": "pt", "audio_kwargs": {"sampling_rate": 16000},
                                              "text_kwargs": {"padding": True}},
                        ).to(args.device)
                        generated = model.generate(**inputs, max_new_tokens=512, do_sample=False)
                        new_tokens = generated[:, inputs.input_ids.shape[1]:]
                        ids = new_tokens[0].tolist()
                        eos = model.generation_config.eos_token_id
                        eos_ids = eos if isinstance(eos, list) else [eos]
                        reached_eos = any(token in eos_ids for token in ids)
                        text = processor.batch_decode(new_tokens, skip_special_tokens=True)[0].strip()
                        del inputs, generated, new_tokens
                    if args.device == "mps":
                        torch.mps.synchronize()
                    mps_driver = torch.mps.driver_allocated_memory() if args.device == "mps" else None
                    del samples
            print(json.dumps({"event": "result", "text": text, "seconds": time.monotonic() - started,
                              "reached_eos": reached_eos, "mps_driver_bytes": mps_driver}), flush=True)
        except Exception as error:
            print(json.dumps({"event": "error", "label": type(error).__name__, "detail": str(error)[:2000]}), flush=True)
            return 1
    return 0


class RunCancelled(Exception):
    pass


def install_cancellation_handler():
    def terminate(_signum, _frame):
        raise RunCancelled("runner_terminated")
    signal.signal(signal.SIGTERM, terminate)


class Worker:
    def __init__(self, command):
        import psutil
        self.psutil = psutil
        env = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
               "HF_HUB_DISABLE_TELEMETRY": "1", "MODELSCOPE_OFFLINE": "1",
               "PYTORCH_ENABLE_MPS_FALLBACK": "0", "TOKENIZERS_PARALLELISM": "false",
               "OMP_NUM_THREADS": "4", "MKL_NUM_THREADS": "4"}
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, env=env, start_new_session=True)
        self.buffer = b""
        self.peak_rss = 0

    def receive(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                self.peak_rss = max(self.peak_rss, self.psutil.Process(self.process.pid).memory_info().rss)
            except self.psutil.NoSuchProcess:
                pass
            if b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                return json.loads(line)
            ready, _, _ = select.select([self.process.stdout], [], [], min(0.05, max(0, deadline - time.monotonic())))
            if ready:
                part = os.read(self.process.stdout.fileno(), 16384)
                if not part:
                    raise RuntimeError("worker_exited")
                self.buffer += part
                if len(self.buffer) > 1024 * 1024:
                    raise RuntimeError("worker_response_limit")
        raise TimeoutError("worker_deadline")

    def request(self, value, timeout):
        self.peak_rss = 0
        self.process.stdin.write((json.dumps(value) + "\n").encode())
        self.process.stdin.flush()
        result = self.receive(timeout)
        result["peak_rss_bytes"] = self.peak_rss
        return result

    def close(self):
        def group_alive():
            self.process.poll()  # reap an exited leader before probing its group
            try:
                os.killpg(self.process.pid, 0)
                return True
            except ProcessLookupError:
                return False
            except PermissionError:
                # Darwin can report EPERM for a group containing only an
                # unreaped zombie. Inspect group IDs, not process arguments.
                for member in self.psutil.process_iter(["pid", "status"]):
                    try:
                        if member.info["status"] != self.psutil.STATUS_ZOMBIE and os.getpgid(member.pid) == self.process.pid:
                            return True
                    except (ProcessLookupError, PermissionError):
                        continue
                return False

        def send_group(sig):
            try:
                os.killpg(self.process.pid, sig)
            except ProcessLookupError:
                pass
            except PermissionError:
                if group_alive():
                    raise

        previous = signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            if not self.process.stdin.closed:
                self.process.stdin.close()
            if self.process.poll() is None:
                try:
                    self.process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
            # A leader can exit while its descendants retain the owned group.
            if group_alive():
                send_group(signal.SIGTERM)
                deadline = time.monotonic() + 1
                while group_alive() and time.monotonic() < deadline:
                    self.process.poll()
                    time.sleep(0.02)
                if group_alive():
                    send_group(signal.SIGKILL)
            self.process.wait(timeout=2)
        finally:
            self.process.stdout.close()
            signal.signal(signal.SIGTERM, previous)


def run(args):
    cases = read_cases(args.manifest, args.combined)
    if args.select:
        cases = [case for case in cases if case["id"] in args.select]
        if len(cases) != len(set(args.select)):
            raise ValueError("unknown_case_id")
    if not args.combined and any(case["frames"] > 30 * 16000 for case in cases):
        raise ValueError("single_clip_exceeds_30_seconds")
    target, verified = verify_model(args.root, args.model)
    del target
    output = args.output.resolve()
    repo = Path(__file__).resolve().parents[2]
    if output.is_relative_to(repo):
        raise ValueError("evidence_must_stay_outside_repository")
    output.parent.mkdir(parents=True, exist_ok=True)
    from importlib.metadata import version
    metadata = {"event": "metadata", "model": args.model, "device": args.device,
                "checkpoint": verified, "python": platform.python_version(), "platform": platform.platform(),
                "packages": {name: version(name) for name in ("torch", "torchaudio", "funasr", "transformers")},
                "manifest_sha256": digest(args.manifest), "runner_sha256": digest(Path(__file__)),
                "model_specs_sha256": digest(Path(__file__).with_name("models.json")), "mode": "offline_fixed_30s_chunks" if args.combined else "offline_clip",
                "tokenizer": TOKENIZER, "itn": True if args.model == "sensevoice" else None,
                "text_normalization": "use_itn=True" if args.model == "sensevoice" else "checkpoint_default_no_override", "threads": 4,
                "clip_timeout_seconds": args.timeout, "cold_first_case": True, "warmup": False,
                "expected_case_ids": [case["id"] for case in cases], "expected_case_count": len(cases),
                "selection": args.select or "all",
                "rss_scope": "worker RSS polled every 50ms; not total system or all Metal memory"}
    command = [sys.executable, str(Path(__file__).resolve()), "--worker", "--root", str(args.root),
               "--model", args.model, "--device", args.device]
    proc = None
    try:
        with output.open("x", encoding="utf-8") as stream:
            def save(item):
                stream.write(json.dumps(item, ensure_ascii=False) + "\n")
                stream.flush()
            save(metadata)
            proc = Worker(command)
            loaded = proc.receive(180)
            loaded["peak_rss_bytes"] = proc.peak_rss
            save(loaded)
            if loaded["event"] != "ready":
                raise RuntimeError("model_load_failed")
            print(json.dumps(loaded), flush=True)
            for index, case in enumerate(cases):
                started = time.monotonic()
                texts, parts = [], []
                bounds = chunks(case["frames"]) if args.combined else [(0, case["frames"])]
                for start, end in bounds:
                    result = proc.request({"wav": case["wav"], "start": start, "end": end}, args.timeout)
                    result.update(start_frame=start, end_frame=end)
                    parts.append(result)
                    if result["event"] != "result":
                        save({"event": "failed", "id": case["id"], "parts": parts})
                        raise RuntimeError("decode_failed")
                    texts.append(result["text"])
                hypothesis = " ".join(texts)
                reference = case["reference_text"]
                seconds = case["frames"] / 16000
                elapsed = time.monotonic() - started
                result = {"event": "case", **case, "cold": index == 0, "hypothesis": hypothesis,
                          "reference_text": reference, "parts": parts, "audio_seconds": seconds,
                          "decode_seconds": sum(part["seconds"] for part in parts), "wall_seconds": elapsed,
                          "rtf": elapsed / seconds, "peak_rss_bytes": max(part["peak_rss_bytes"] for part in parts),
                          "complete": all(part["reached_eos"] is not False for part in parts),
                          **score(reference, hypothesis)}
                save(result)
                if not result["complete"]:
                    raise RuntimeError("generation_token_limit")
                print(json.dumps({key: result[key] for key in ("id", "cold", "audio_seconds", "wall_seconds", "rtf", "wer", "errors", "reference_words", "peak_rss_bytes", "complete")}), flush=True)
    except BaseException as error:
        if proc:
            with output.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"event": "abort", "label": type(error).__name__}) + "\n")
        raise
    finally:
        if proc:
            proc.close()
    return 0


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--model", choices=("sensevoice", "nano"), required=True)
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--combined", action="store_true")
    parser.add_argument("--select", action="append")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.worker:
            return worker(args)
        if not args.manifest or not args.output or not 0 < args.timeout <= 600:
            parser.error("--manifest, --output and a timeout in (0,600] are required")
        install_cancellation_handler()
        return run(args)
    except (RunCancelled, KeyboardInterrupt) as error:
        print(json.dumps({"event": "cancelled", "label": type(error).__name__}), flush=True)
        return 143 if isinstance(error, RunCancelled) else 130
    except Exception as error:
        print(json.dumps({"event": "error", "label": type(error).__name__,
                          **({"detail": str(error)[:2000]} if args.worker else {})}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
