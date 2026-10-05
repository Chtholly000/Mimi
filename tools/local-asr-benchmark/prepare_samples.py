#!/usr/bin/env python3
"""Prepare a fixed public LibriSpeech subset; no ASR or product configuration."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


REPOSITORY = "openslr/librispeech_asr"
REVISION = "71cacbfb7e2354c4226d01e70d77d5fca3d04ba1"
SEED = "mimi-librispeech-asr-v1"
COUNT_PER_SPLIT = 20
SOURCES = {
    "test-clean": {
        "path": "all/test.clean/0000.parquet",
        "size": 350452636,
        "sha256": "7113aa4c3cf963fb54697145719a7725f984c8836d1c494a554cbb9f1a017df0",
    },
    "test-other": {
        "path": "all/test.other/0000.parquet",
        "size": 332873172,
        "sha256": "38e0c86a8104585c577badd707ca4331e20fa2c645f46180af0b7bcdecff9249",
    },
}
FIELDS = ("id", "audio_path", "reference", "split", "speaker_id", "sha256", "duration_s")
SELECTION_RULE = (
    "First 20 speaker IDs by SHA256(seed|split|speaker|id); one utterance per "
    "speaker by smallest SHA256(seed|split|utterance|id); no transcript, "
    "duration, model output, demographic or quality filtering."
)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def rank(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def atomic_bytes(path, data, *, replace=False):
    if path.exists():
        if path.read_bytes() == data:
            return
        if not replace:
            raise ValueError(f"existing_output_differs: {path.name}")
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode(), replace=True)


def verify_shard(path, spec):
    if path.stat().st_size != spec["size"] or digest(path) != spec["sha256"]:
        raise ValueError(f"source_size_or_sha256_mismatch: {path.parent.name}")


def source_url(spec):
    return f"https://huggingface.co/datasets/{REPOSITORY}/resolve/{REVISION}/{spec['path']}"


def obtain_shard(source_root, split, spec, offline):
    directory = source_root / split
    path = directory / "source.parquet"
    if path.exists():
        verify_shard(path, spec)
        return path
    if offline:
        raise FileNotFoundError(f"offline_source_missing: {split}/source.parquet")
    private_directory(directory)
    partial = path.with_suffix(".parquet.part")
    # Fixed public URL, at most two concurrent downloads, resumable private cache.
    subprocess.run([
        "curl", "--fail", "--location", "--show-error", "--silent",
        "--proto", "=https", "--proto-redir", "=https", "--retry", "2",
        "--connect-timeout", "30", "--max-time", "1800",
        "--max-filesize", str(spec["size"]), "--continue-at", "-",
        "--output", str(partial), source_url(spec),
    ], check=True, timeout=5500)
    partial.chmod(0o600)
    verify_shard(partial, spec)
    os.replace(partial, path)
    return path


def select_rows(parquet, split):
    entries, offset = [], 0
    for group in range(parquet.num_row_groups):
        table = parquet.read_row_group(
            group, columns=["id", "speaker_id", "chapter_id", "text"], use_threads=False
        )
        for within, row in enumerate(table.to_pylist()):
            if not re.fullmatch(r"\d+-\d+-\d+", row["id"]):
                raise ValueError("unexpected_utterance_id")
            entries.append({**row, "row_group": group,
                            "row_within_group": within, "row_index": offset + within})
        offset += table.num_rows
    speakers = sorted(
        {str(row["speaker_id"]) for row in entries},
        key=lambda speaker: rank(f"{SEED}|{split}|speaker|{speaker}"),
    )[:COUNT_PER_SPLIT]
    if len(speakers) != COUNT_PER_SPLIT:
        raise ValueError("insufficient_distinct_speakers")
    selected = [min(
        (row for row in entries if str(row["speaker_id"]) == speaker),
        key=lambda row: rank(f"{SEED}|{split}|utterance|{row['id']}"),
    ) for speaker in speakers]
    return selected, len(entries)


def extract_split(root, split, path, spec):
    import pyarrow.parquet as pq
    import soundfile as sf

    directory = root / split
    private_directory(directory)
    parquet = pq.ParquetFile(path, pre_buffer=False)
    selected, total_rows = select_rows(parquet, split)
    prepared = {}
    for group in sorted({row["row_group"] for row in selected}):
        audio = parquet.read_row_group(group, columns=["audio"], use_threads=False).column("audio")
        for row in (r for r in selected if r["row_group"] == group):
            blob = audio[row["row_within_group"]].as_py()["bytes"]
            info = sf.info(io.BytesIO(blob))
            if (info.samplerate, info.channels, info.subtype) != (16000, 1, "PCM_16"):
                raise ValueError("unexpected_source_audio_format")
            samples, rate = sf.read(io.BytesIO(blob), dtype="int16", always_2d=True)
            if len(samples) != info.frames:
                raise ValueError("source_frame_count_mismatch")
            wav = io.BytesIO()
            sf.write(wav, samples, rate, subtype="PCM_16", format="WAV")
            wav_bytes = wav.getvalue()
            # Verify lossless container conversion before making the WAV usable.
            decoded, check_rate = sf.read(io.BytesIO(wav_bytes), dtype="int16", always_2d=True)
            if check_rate != rate or not (decoded == samples).all():
                raise ValueError("wav_conversion_mismatch")
            target = directory / f"{row['id']}.wav"
            atomic_bytes(directory / f"{row['id']}.flac", blob)
            atomic_bytes(target, wav_bytes)
            prepared[row["id"]] = {
                "id": row["id"], "audio_path": str(target), "reference": row["text"],
                "split": split, "speaker_id": str(row["speaker_id"]),
                "sha256": hashlib.sha256(wav_bytes).hexdigest(), "duration_s": len(samples) / rate,
                "source_audio_sha256": hashlib.sha256(blob).hexdigest(),
                "source_row_index": row["row_index"],
            }
    rows = [prepared[row["id"]] for row in selected]
    metadata = {
        "source": {**spec, "url": source_url(spec), "revision": REVISION},
        "full_shard_sha256_verified": True, "rows": total_rows,
        "row_groups": parquet.num_row_groups, "selection": selected,
        "selection_rule": SELECTION_RULE, "selection_seed": SEED,
    }
    write_json(directory / "selection.json", metadata)
    print(json.dumps({"split": split, "count": len(rows),
                      "speakers": len({row['speaker_id'] for row in rows}),
                      "duration_s": sum(row["duration_s"] for row in rows)}), flush=True)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/mimi-local-models/samples/librispeech-balanced-v1")
    parser.add_argument("--source-root", type=Path, help="Reuse verified split/source.parquet files here")
    parser.add_argument("--offline", action="store_true", help="Fail if either verified source shard is missing")
    args = parser.parse_args()
    os.umask(0o077)
    root = args.root.expanduser().resolve()
    source_root = (args.source_root or root).expanduser().resolve()
    if any((parent / ".git").exists() for parent in (root, *root.parents)):
        raise ValueError("sample_output_must_be_outside_git")
    private_directory(root)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {split: pool.submit(obtain_shard, source_root, split, spec, args.offline)
                   for split, spec in SOURCES.items()}
        shards = {split: future.result() for split, future in futures.items()}
    rows = []
    for split, spec in SOURCES.items():
        rows.extend(extract_split(root, split, shards[split], spec))
    if len(rows) != 40 or len({row["id"] for row in rows}) != 40:
        raise ValueError("unexpected_selection_count_or_duplicate_id")
    manifest_bytes = "".join(json.dumps({key: row[key] for key in FIELDS}, ensure_ascii=False) + "\n" for row in rows).encode()
    manifest = root / "manifest.jsonl"
    atomic_bytes(manifest, manifest_bytes)
    import pyarrow
    import soundfile
    write_json(root / "provenance.json", {
        "dataset": REPOSITORY, "revision": REVISION, "license": "CC-BY-4.0",
        "official_page": "https://www.openslr.org/12", "selection_seed": SEED,
        "selection_rule": SELECTION_RULE,
        "sources": {split: {**spec, "url": source_url(spec)} for split, spec in SOURCES.items()},
        "count": len(rows), "duration_s": sum(row["duration_s"] for row in rows),
        "source_audio_files": [{key: row[key] for key in ("id", "split", "source_audio_sha256", "source_row_index")} for row in rows],
        "full_shard_sha256_verified": True,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "preparation": "Full pinned shards verified by size and SHA256; local row-group reads; lossless FLAC to PCM16 WAV container conversion; no resampling, VAD, cropping, silence padding or inference.",
        "versions": {"pyarrow": pyarrow.__version__, "soundfile": soundfile.__version__,
                     "libsndfile": soundfile.__libsndfile_version__},
    })
    print(json.dumps({"manifest": str(manifest), "count": len(rows),
                      "duration_s": sum(row["duration_s"] for row in rows),
                      "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}))


if __name__ == "__main__":
    main()
