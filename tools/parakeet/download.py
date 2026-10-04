"""Explicit setup only. Runtime never imports this downloader."""
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
from huggingface_hub import snapshot_download

REPO = "mlx-community/parakeet-tdt-0.6b-v3"
REVISION = "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15"

if __name__ == "__main__":
    directory = Path(sys.argv[1])
    snapshot_download(REPO, revision=REVISION, local_dir=directory,
                      allow_patterns=["config.json", "model.safetensors", "README.md"], token=False)
    hashes = {}
    for name in ("config.json", "model.safetensors", "README.md"):
        with (directory / name).open("rb") as stream:
            hashes[name] = hashlib.file_digest(stream, "sha256").hexdigest()
    (directory / "mimi-manifest.json").write_text(json.dumps({
        "repository": REPO, "revision": REVISION, "sha256": hashes,
        "license": "CC-BY-4.0", "base_model": "nvidia/parakeet-tdt-0.6b-v3",
    }, indent=2) + "\n")
    print(json.dumps({"event": "downloaded", "revision": REVISION}))
