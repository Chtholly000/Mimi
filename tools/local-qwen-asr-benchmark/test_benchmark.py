import json
import contextlib
import fcntl
import io
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest import mock
import wave

from common import literal_tokens, load_cases, private_json, score, sha256, verify
import benchmark


class BenchmarkTests(unittest.TestCase):
    def test_literal_retains_number_difference(self):
        result = score(literal_tokens("Thirteen minutes, not thirty."), literal_tokens("13 minutes not 30"))
        self.assertEqual(result["edits"], 2)
        self.assertEqual(result["reference_words"], 4)

    def test_wer_insertions_deletions_empty(self):
        self.assertEqual(score(["a", "b"], ["a"])["edits"], 1)
        self.assertEqual(score(["a"], ["a", "b"])["edits"], 1)
        self.assertIsNone(score([], ["hallucination"])["wer"])

    def test_private_checkpoint_and_git_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "result.json"
            private_json(path, {"cases": []})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"cases": []})
            (root / ".git").write_text("gitdir: somewhere")
            with self.assertRaisesRegex(ValueError, "outside_git"):
                private_json(path, {})

    def test_verify_rejects_modified_asset_and_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / "asset"
            path.write_bytes(b"expected")
            digest = sha256(path)
            verify(path, digest, 8)
            link = root / "link"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                verify(link, digest)
            path.write_bytes(b"altered!")
            with self.assertRaises(ValueError):
                verify(path, digest)

    def test_public_jsonl_contract_and_audio_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            audio = root / "audio.wav"
            with wave.open(str(audio), "wb") as wav:
                wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                wav.writeframes(b"\0" * 3200)
            case = {"id": "case", "audio_path": str(audio), "reference": "test",
                    "split": "test-clean", "sha256": sha256(audio)}
            manifest = root / "manifest.jsonl"
            manifest.write_text(json.dumps(case) + "\n")
            self.assertEqual(load_cases([manifest])[0]["duration_s"], 0.1)
            manifest.write_text((json.dumps(case) + "\n") * 2)
            with self.assertRaisesRegex(ValueError, "duplicate"):
                load_cases([manifest])

    def test_exclusive_lock_rejects_before_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            with (Path(folder) / "benchmark.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                process = subprocess.run([sys.executable, benchmark.__file__, "--model", "0.6B",
                                          "--cache", folder, "--manifest", "/missing.jsonl",
                                          "--output", str(Path(folder) / "out.json")],
                                         capture_output=True, text=True, timeout=5)
                self.assertEqual(process.returncode, 2)
                self.assertEqual(json.loads(process.stderr)["status"], "busy")

    def test_deadline_reaps_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            worker = Path(folder) / "sleep.py"
            worker.write_text("import time\ntime.sleep(60)\n")
            output = io.StringIO()
            with mock.patch.object(benchmark, "__file__", str(worker)), contextlib.redirect_stdout(output):
                self.assertEqual(benchmark.supervise([], 0.05), 124)
            status = json.loads(output.getvalue())
            self.assertTrue(status["reaped"])
            self.assertLess(status["cancel_ms"], 3000)

    def test_rejected_rerun_preserves_lifecycle(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "out.json"
            lifecycle = output.with_suffix(".lifecycle.json")
            lifecycle.write_text('{"original": true}\n')
            process = subprocess.run([sys.executable, benchmark.__file__, "--model", "0.6B",
                                      "--cache", folder, "--manifest", "/missing.jsonl",
                                      "--output", str(output)], capture_output=True, timeout=5)
            self.assertEqual(process.returncode, 1)
            self.assertEqual(lifecycle.read_text(), '{"original": true}\n')

    def test_owned_group_cleanup_after_leader_exit(self):
        fake = mock.Mock(pid=999999)
        fake.wait.return_value = 0
        with mock.patch.object(benchmark.subprocess, "Popen", return_value=fake), \
                mock.patch.object(benchmark, "signal_group") as signal_group:
            self.assertEqual(benchmark.supervise([], 5), 0)
            signal_group.assert_called_once_with(fake.pid, benchmark.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
