#!/usr/bin/env python3
"""Create public synthetic English fixtures using installed macOS voices; no capture.

The original fixture text below is dedicated to the public domain (CC0).
Generated speech remains local and is not redistributed by this repository.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import wave

CASES = [
    ("negation", "Do not open the door until the alarm has stopped."),
    ("negation", "I didn't say the server was down; I said it was slow."),
    ("negation", "You can save the file, but you cannot overwrite the backup."),
    ("negation", "Neither player has enough energy to use that ability."),
    ("numbers", "The total is twenty three dollars and forty five cents."),
    ("numbers", "Set the timer for thirteen minutes, not thirty minutes."),
    ("numbers", "We need six batteries, twelve cables, and one spare controller."),
    ("numbers", "The meeting starts at eight fifteen on October fifth."),
    ("names", "Mimi sends the recognized English text to Index Translate."),
    ("names", "OpenAI and NVIDIA both provide speech recognition models."),
    ("names", "Alice and Robert are waiting outside the London station."),
    ("names", "GitHub stores the source code for the Whisper project."),
    ("game", "The boss is immune to fire, so switch to ice damage."),
    ("game", "Don't revive me yet; there is an enemy behind the stairs."),
    ("game", "Reload your weapon before entering the next room."),
    ("game", "We lost the first round, but we can still win the match."),
    ("game", "My ultimate ability will be ready in about ten seconds."),
    ("game", "Turn left at the bridge and watch the sniper on the roof."),
    ("contrast", "The password is case sensitive, and spaces are not allowed."),
    ("contrast", "Lower the music volume without muting the dialogue."),
    ("contrast", "She thought the package had arrived, but it was still in transit."),
    ("contrast", "A fast response does not always mean an accurate answer."),
    ("sequence", "First stop the recording, then close the application."),
    ("sequence", "If the connection fails, wait a moment and try again."),
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    root = args.output.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (root / "manifest.json").exists():
        raise SystemExit("Fixture already exists; use a new directory to preserve comparisons.")
    entries = []
    combined = root / "english-24.wav"
    with wave.open(str(combined), "wb") as joined:
        joined.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        for index, (tag, text) in enumerate(CASES, 1):
            name = f"en-{index:02d}"
            voice = "Samantha" if index <= 16 else "Daniel"
            rate = 160 if index <= 12 else 190
            wav, reference = root / f"{name}.wav", root / f"{name}.txt"
            subprocess.run(["/usr/bin/say", "-v", voice, "-r", str(rate),
                            "--file-format=WAVE", "--data-format=LEI16@16000",
                            "-o", str(wav), text], check=True)
            reference.write_text(text + "\n", encoding="utf-8")
            with wave.open(str(wav), "rb") as audio:
                if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                    raise RuntimeError("fixture_format_invalid")
                pcm = audio.readframes(audio.getnframes())
                if len(pcm) < 32000 or not any(pcm):
                    raise RuntimeError("fixture_audio_empty")
            joined.writeframes(pcm)
            joined.writeframes(bytes(32000))
            entries.append({"id": name, "tag": tag, "voice": voice, "rate": rate,
                            "wav": wav.name, "reference": reference.name,
                            "sha256": digest(wav), "reference_sha256": digest(reference),
                            "seconds": len(pcm) / 32000})
    (root / "english-24.txt").write_text("\n".join(text for _, text in CASES) + "\n")
    manifest = {"id": "mimi-public-english-24-v1", "source": "original CC0 text; macOS say",
                "scope": "synthetic English only; no human speech, accents, music or overlap claim",
                "format": "16000 Hz mono signed little-endian PCM16 WAV", "capture": False,
                "generator_sha256": digest(Path(__file__)), "cases": entries,
                "combined": {"wav": combined.name, "reference": "english-24.txt",
                             "sha256": digest(combined), "gap_seconds": 1}}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Created {len(entries)} fixtures: {root / 'manifest.json'}")


if __name__ == "__main__":
    main()
