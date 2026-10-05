"""Content-safe benchmark helpers; no model imports or implicit downloads."""

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import wave

HERE = Path(__file__).resolve().parent
DEFAULT_CACHE = Path.home() / ".local/share/mimi-local-models/qwen-asr"
MAX_SECONDS = 180
MAX_CASES = 200


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify(path, expected, size=None):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("asset_missing_or_symlink")
    if size is not None and path.stat().st_size != size:
        raise ValueError("asset_size_mismatch")
    if sha256(path) != expected:
        raise ValueError("asset_hash_mismatch")


def literal_tokens(text):
    return re.findall(r"[a-z0-9]+", text.casefold())


def score(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        row = [i]
        for j, right in enumerate(hypothesis, 1):
            row.append(min(row[-1] + 1, previous[j] + 1,
                           previous[j - 1] + (left != right)))
        previous = row
    edits = previous[-1]
    return {"edits": edits, "reference_words": len(reference),
            "wer": edits / len(reference) if reference else None,
            "hypothesis_words": len(hypothesis)}


def private_json(path, value):
    """Atomic private checkpoints; callers choose an output outside any Git tree."""
    path = Path(path).resolve()
    if any((parent / ".git").exists() for parent in (path.parent, *path.parents)):
        raise ValueError("output_must_be_outside_git")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".qwen-result-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_cases(manifest_paths, combined=False):
    cases = []
    for name in manifest_paths:
        path = Path(name).resolve()
        raw = path.read_text()
        if path.suffix == ".jsonl":
            entries = [json.loads(line) for line in raw.splitlines() if line.strip()]
            for entry in entries:
                cases.append({**entry, "wav": str(Path(entry["audio_path"]).resolve()),
                              "reference_text": entry["reference"]})
        else:
            manifest = json.loads(raw)
            entries = manifest.get("cases", [manifest])
            if combined and "combined" in manifest:
                entries = [*entries, {**manifest["combined"], "id": "tts24-combined",
                                     "split": "tts24-combined"}]
            for entry in entries:
                wav = path.parent / entry["wav"]
                ref = path.parent / entry["reference"]
                if "reference_sha256" in entry:
                    verify(ref, entry["reference_sha256"])
                cases.append({**entry, "id": entry.get("id", manifest["id"]),
                              "split": entry.get("split", "tts24" if "cases" in manifest else "jfk"),
                              "wav": str(wav), "reference_text": ref.read_text().strip()})
    if not 1 <= len(cases) <= MAX_CASES or len({c["id"] for c in cases}) != len(cases):
        raise ValueError("invalid_case_count_or_duplicate_id")
    for case in cases:
        verify(case["wav"], case["sha256"])
        if len(case["reference_text"]) > 20000:
            raise ValueError("reference_too_long")
        with wave.open(case["wav"], "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 16000, "NONE"):
                raise ValueError("expected_mono_pcm16_16khz")
            seconds = wav.getnframes() / 16000
            if not 0 < seconds <= MAX_SECONDS:
                raise ValueError("audio_duration_out_of_bounds")
            case["duration_s"] = seconds
    return cases
