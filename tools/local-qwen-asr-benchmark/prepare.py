#!/usr/bin/env python3
"""Download only pinned public assets. Never imports MLX or loads a model."""

import argparse
import json
import os
from pathlib import Path
import tarfile
import urllib.request

from common import DEFAULT_CACHE, HERE, verify


def download(url, dest, expected, size=None):
    if dest.exists():
        verify(dest, expected, size)
        return
    dest.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    temporary = dest.with_name(dest.name + ".download")
    # Only this tool's known temporary file is replaced; completed caches persist.
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
        os.fchmod(output.fileno(), 0o600)
        total = 0
        for block in iter(lambda: response.read(1024 * 1024), b""):
            total += len(block)
            if total > (size if size is not None else 32 * 1024 * 1024):
                raise ValueError("download_exceeds_expected_size")
            output.write(block)
        output.flush()
        os.fsync(output.fileno())
    verify(temporary, expected, size)
    temporary.replace(dest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    args = parser.parse_args()
    args.cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(args.cache, 0o700)
    assets = json.loads((HERE / "assets.json").read_text())
    runtime = assets["runtime"]
    archive = args.cache / "mlx-qwen3-asr-source.tar.gz"
    download(f"https://codeload.github.com/{runtime['repo']}/tar.gz/{runtime['revision']}",
             archive, runtime["archive_sha256"])
    source = args.cache / ("mlx-qwen3-asr-" + runtime["revision"])
    if not source.exists():
        with tarfile.open(archive) as bundle:
            bundle.extractall(args.cache, filter="data")
    for name, expected in runtime["tree_sha256"].items():
        verify(source / name, expected)
    for model in assets["models"].values():
        dest = args.cache / "models" / model["repo"].split("/")[-1]
        for item in model["files"]:
            download(f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{item['name']}",
                     dest / item["name"], item["sha256"], item["bytes"])
    normalizer = assets["normalizer"]
    base = f"https://raw.githubusercontent.com/{normalizer['repository']}/{normalizer['revision']}"
    for name, expected in normalizer["files"].items():
        download(f"{base}/whisper/normalizers/{name}",
                 args.cache / "normalizer/whisper_normalizers" / name, expected)
    download(f"{base}/LICENSE", args.cache / "normalizer/LICENSE", normalizer["license_sha256"])
    print(json.dumps({"status": "assets_verified", "models_loaded": False}))


if __name__ == "__main__":
    main()
