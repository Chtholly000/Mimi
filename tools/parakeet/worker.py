"""One offline MLX model. stdin/stdout are bounded functional JSONL, not logs."""
import base64
import contextlib
import json
import os
from pathlib import Path
import resource
import sys
import time

from segmentation import MAX_SEGMENT_BYTES


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def main():
    started = time.monotonic()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    directory = Path(sys.argv[1]).resolve(strict=True)
    if not all((directory / name).is_file() for name in ("config.json", "model.safetensors")):
        raise RuntimeError("model_missing")
    # Dependency messages cannot enter the result protocol. The parent also
    # discards worker stderr, so arbitrary library exceptions expose no content.
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        import numpy as np
        from parakeet_mlx import from_pretrained
        from parakeet_mlx.audio import get_logmel

        mx.set_cache_limit(256 * 1024 * 1024)
        model = from_pretrained(str(directory))
        mx.eval(model.parameters())

        def transcribe(pcm):
            audio = mx.array(np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0)
            return model.generate(get_logmel(audio, model.preprocessor_config))[0].text.strip()

        transcribe(bytes(25_600))  # bounded silent warm-up, never a transcript event
    emit({"event": "ready", "load_ms": round((time.monotonic() - started) * 1000, 1),
          "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
    while True:
        line = sys.stdin.buffer.readline(400_001)
        if not line:
            return
        if len(line) > 400_000 or not line.endswith(b"\n"):
            raise ValueError("input_limit")
        request = json.loads(line)
        pcm = base64.b64decode(request["pcm"], validate=True)
        if len(pcm) < 640 or len(pcm) > MAX_SEGMENT_BYTES or len(pcm) % 2:
            raise ValueError("invalid_pcm")
        started = time.monotonic()
        with contextlib.redirect_stdout(sys.stderr):
            text = transcribe(pcm)
        if len(text.encode("utf-8")) > 16_384:
            raise ValueError("output_limit")
        emit({"event": "result", "text": text,
              "decode_ms": round((time.monotonic() - started) * 1000, 1),
              "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
        pcm, text, request = b"", "", None


if __name__ == "__main__":
    try:
        main()
    except Exception:
        emit({"event": "error", "code": "worker_failed"})
        sys.exit(1)
