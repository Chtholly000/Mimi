#!/usr/bin/env python3
"""Fetch the fixed public JFK speech excerpt from upstream's test samples."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.request
import wave

REV = "927cfce34f31707e17f2bff35c349632fb9e2c3a"
HASH = "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"
SOURCE = f"https://raw.githubusercontent.com/ggml-org/whisper.cpp/{REV}/samples/jfk.wav"
REFERENCE_SOURCE = "https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches/inaugural-address-19610120"
REFERENCE = "And so, my fellow Americans, ask not what your country can do for you, ask what you can do for your country."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    root = parser.parse_args().output.expanduser().resolve()
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    wav = root / "jfk.wav"
    if not wav.exists():
        with urllib.request.urlopen(SOURCE, timeout=30) as response:
            data = response.read(1024 * 1024)
        if hashlib.sha256(data).hexdigest() != HASH:
            raise RuntimeError("sample_hash_mismatch")
        wav.write_bytes(data)
    if hashlib.sha256(wav.read_bytes()).hexdigest() != HASH:
        raise RuntimeError("sample_hash_mismatch")
    with wave.open(str(wav), "rb") as audio:
        assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (16000, 1, 2)
        seconds = audio.getnframes() / 16000
    (root / "jfk.txt").write_text(REFERENCE + "\n")
    (root / "manifest.json").write_text(json.dumps({
        "id": "whisper-cpp-jfk-927cfce", "source": SOURCE, "wav": "jfk.wav",
        "sha256": HASH, "seconds": seconds, "reference": "jfk.txt",
        "reference_source": REFERENCE_SOURCE,
        "reference_crosscheck": f"https://github.com/ggml-org/whisper.cpp/blob/{REV}/tests/parakeet-expected-jfk-output.txt",
        "scope": "one familiar 1961 US presidential speech excerpt; not a held-out accuracy benchmark",
        "capture": False}, indent=2) + "\n")
    print(root / "manifest.json")


if __name__ == "__main__":
    main()
