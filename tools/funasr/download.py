#!/usr/bin/env python3
"""Explicit download only. No model imports, loading, credentials or inference."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def prepare_normalizer(root):
    import urllib.request
    spec = json.loads(Path(__file__).with_name("normalizer.json").read_text())
    target = root / "normalizer"
    package = target / "whisper_normalizers"
    package.mkdir(parents=True, exist_ok=True)
    urls = {"whisper_normalizers/" + name: ("whisper/normalizers/" + name, checksum)
            for name, checksum in spec["files"].items()}
    urls["LICENSE"] = ("LICENSE", spec["license_sha256"])
    for name, (source, checksum) in urls.items():
        path = target / name
        if path.exists() and sha256(path) == checksum:
            continue
        url = f"https://raw.githubusercontent.com/{spec['repository']}/{spec['revision']}/{source}"
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(1024 * 1024)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise ValueError("normalizer_hash_mismatch")
        temporary = path.with_suffix(path.suffix + ".part")
        temporary.write_bytes(data)
        temporary.replace(path)
    (target / "manifest.json").write_text(json.dumps(spec, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".local/share/mimi-local-models/funasr")
    args = parser.parse_args()
    os.umask(0o077)
    from huggingface_hub import HfApi, snapshot_download
    specs = json.loads(Path(__file__).with_name("models.json").read_text())
    args.root.mkdir(parents=True, exist_ok=True)
    prepare_normalizer(args.root)
    for name, spec in specs.items():
        info = HfApi(token=False).model_info(spec["repo"], revision=spec["revision"], files_metadata=True)
        if info.sha != spec["revision"]:
            raise ValueError("revision_mismatch")
        target = args.root / "models" / name
        snapshot_download(repo_id=spec["repo"], revision=spec["revision"], allow_patterns=spec["files"],
                          local_dir=target, token=False, max_workers=2)
        metadata = {item.rfilename: item for item in info.siblings}
        files = {}
        for filename in spec["files"]:
            path = target / filename
            item = metadata[filename]
            if path.stat().st_size != item.size:
                raise ValueError("size_mismatch")
            digest = sha256(path)
            if digest != spec["sha256"][filename] or (item.lfs and digest != item.lfs.sha256):
                raise ValueError("digest_mismatch")
            files[filename] = {"size": path.stat().st_size, "sha256": digest}
        manifest = {**spec, "files": files}
        (target / "verified.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({"model": name, "revision": spec["revision"], "bytes": sum(f["size"] for f in files.values()), "verified": True}), flush=True)


if __name__ == "__main__":
    main()
