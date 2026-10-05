#!/usr/bin/env python3
"""Verified, cache-preserving install. Does not start the service or run a model."""
import hashlib
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import tarfile
import urllib.request

SOURCE_REV = "927cfce34f31707e17f2bff35c349632fb9e2c3a"  # whisper.cpp v1.9.4
SOURCE_SHA = "41b664fee09e79176ac277b5237debec34f8d74af3c7d71f333f1ec67989ecde"
MODEL_REV = "5359861c739e955e79d9a303bcbc70fb988958b1"
MODEL_SHA = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"
MODEL_NAME = "ggml-large-v3-turbo-q5_0.bin"
ROOT = Path.home() / ".local/share/mimi-local-models/whisper"


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, path, expected):
    if path.exists():
        if sha(path) != expected:
            raise RuntimeError("cached_file_hash_mismatch")
        return
    partial = path.with_suffix(path.suffix + ".download")
    with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
    if sha(partial) != expected:
        raise RuntimeError("download_hash_mismatch")
    partial.replace(path)


def main():
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    archive = ROOT / "whisper-source.tar.gz"
    model = ROOT / MODEL_NAME
    download(f"https://github.com/ggml-org/whisper.cpp/archive/{SOURCE_REV}.tar.gz", archive, SOURCE_SHA)
    download(f"https://huggingface.co/ggerganov/whisper.cpp/resolve/{MODEL_REV}/{MODEL_NAME}", model, MODEL_SHA)
    upstream = ROOT / f"whisper.cpp-{SOURCE_REV}"
    if not upstream.exists():
        with tarfile.open(archive) as bundle:
            bundle.extractall(ROOT, filter="data")
    # A previous interrupted extraction or edited cache must not silently turn
    # the pinned archive into an unverified build. Preserve it and fail closed.
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            if member.isfile():
                installed = ROOT / member.name
                if (installed.is_symlink() or not installed.is_file()
                        or hashlib.sha256(bundle.extractfile(member).read()).hexdigest() != sha(installed)):
                    raise RuntimeError("source_cache_verification_failed")
    build = ROOT / "build"
    subprocess.run(["cmake", "-S", str(source), "-B", str(build),
                    "-DCMAKE_BUILD_TYPE=Release", f"-DWHISPER_SOURCE={upstream}"], check=True)
    subprocess.run(["cmake", "--build", str(build), "--target", "mimi-whisper-worker",
                    "--config", "Release", "-j", "4"], check=True)
    shutil.copy2(build / "mimi-whisper-worker", ROOT / "mimi-whisper-worker")
    for name in ("bridge.py", "control.sh", "status.py", "README.md", "measurements.md"):
        shutil.copy2(source / name, ROOT / name)
    (ROOT / "control.sh").chmod(0o700)
    token = ROOT / "bridge-token"
    if not token.exists():
        with token.open("x") as stream:
            stream.write(secrets.token_urlsafe(32) + "\n")
        token.chmod(0o600)
    # Never silently replace an existing local token.
    from bridge import load_token
    load_token(token)
    arguments = [str(ROOT / "venv/bin/python3"), "-u", str(ROOT / "bridge.py"),
                 "--worker", str(ROOT / "mimi-whisper-worker"),
                 "--model", str(model), "--token-file", str(token), "--port", "18082"]
    with (ROOT / "service.plist").open("wb") as stream:
        plistlib.dump({"Label": "local.mimi-whisper", "ProgramArguments": arguments,
                      "WorkingDirectory": str(ROOT), "StandardOutPath": "/dev/null",
                      "StandardErrorPath": "/dev/null", "RunAtLoad": True,
                      "KeepAlive": False, "ProcessType": "Background", "Umask": 0o077}, stream)
    print("Installed. The model has not been loaded and no service was started.")
    print(f"Start explicitly: {ROOT / 'control.sh'} start")


if __name__ == "__main__":
    main()
