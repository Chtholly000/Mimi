"""No model imports: public PCM fixtures and owned fake worker processes only."""
import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from parakeet_standalone import load_cases, supervise


class SupervisionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def fake(self, body):
        path = self.root / "worker.py"
        path.write_text(
            "import json,os,signal,subprocess,sys,time\n"
            "pipe=os.fdopen(int(sys.argv[-1]),'w',buffering=1)\n"
            "def send(value): pipe.write(json.dumps(value)+'\\n');pipe.flush()\n"
            + body
        )
        return [sys.executable, str(path)]

    def stopped(self, pid):
        end = time.monotonic() + 2
        while time.monotonic() < end:
            state = subprocess.run(["ps", "-p", str(pid), "-o", "stat="],
                                   capture_output=True, text=True, timeout=2).stdout.strip()
            if not state or state.startswith("Z"):
                return
            time.sleep(0.02)
        self.fail("owned process still running")

    def run_fake(self, command, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return supervise(command, **kwargs)

    def test_load_and_clip_deadlines_reap_worker(self):
        for phase in ("load", "clip"):
            with self.subTest(phase=phase):
                pidfile = self.root / f"{phase}.pid"
                body = f"open({str(pidfile)!r},'w').write(str(os.getpid()))\n"
                body += "signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
                if phase == "clip":
                    body += "send({'event':'loaded','cases':1})\nsend({'event':'case_started','index':0})\n"
                command = self.fake(body + "time.sleep(60)\n")
                started = time.monotonic()
                self.assertEqual(self.run_fake(command, load_timeout=0.3, clip_timeout=0.03), 124)
                self.assertLess(time.monotonic() - started, 3)
                self.stopped(int(pidfile.read_text()))

    def test_success_requires_completed_progress(self):
        command = self.fake("send({'event':'loaded','cases':1})\n"
                            "send({'event':'case_started','index':0})\n"
                            "send({'event':'case_completed','index':0,'id':'fixture','decode_s':.01,'rtf':.1})\n"
                            "send({'event':'done'})\n")
        self.assertEqual(self.run_fake(command, load_timeout=2, clip_timeout=1), 0)
        command = self.fake("send({'event':'loaded','cases':1})\nsend({'event':'done'})\n")
        self.assertEqual(self.run_fake(command, load_timeout=2, clip_timeout=1), 1)

    def test_parent_signals_reap_worker(self):
        module_dir = str(Path(__file__).resolve().parent)
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signum=signum):
                pidfile = self.root / f"signal-{signum}.pid"
                command = self.fake("signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
                                    f"open({str(pidfile)!r},'w').write(str(os.getpid()))\n"
                                    "time.sleep(60)\n")
                driver = (f"import sys;sys.path.insert(0,{module_dir!r});"
                          "from parakeet_standalone import supervise;"
                          f"sys.exit(supervise({command!r},load_timeout=30))")
                parent = subprocess.Popen([sys.executable, "-B", "-c", driver],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                try:
                    end = time.monotonic() + 3
                    while not pidfile.exists() and time.monotonic() < end:
                        time.sleep(.02)
                    self.assertTrue(pidfile.exists(), "worker did not start")
                    parent.send_signal(signum)
                    self.assertEqual(parent.wait(timeout=4), 128 + signum)
                    self.stopped(int(pidfile.read_text()))
                finally:
                    if parent.poll() is None:
                        parent.kill()
                        parent.wait(timeout=2)

    def test_leader_exit_does_not_leave_ignoring_descendant(self):
        pidfile = self.root / "descendant.pid"
        descendant = ("import os,signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);"
                      f"open({str(pidfile)!r},'w').write(str(os.getpid()));time.sleep(60)")
        command = self.fake(
            f"subprocess.Popen([sys.executable,'-c',{descendant!r}])\n"
            f"while not os.path.exists({str(pidfile)!r}): time.sleep(.01)\n"
            "send({'event':'loaded','cases':1})\n"
            "send({'event':'case_started','index':0})\n"
            "send({'event':'case_completed','index':0,'id':'fixture','decode_s':.01,'rtf':.1})\n"
            "send({'event':'done'})\n"
        )
        self.assertEqual(self.run_fake(command, load_timeout=2, clip_timeout=1), 0)
        self.stopped(int(pidfile.read_text()))

    def test_progress_is_bounded(self):
        command = self.fake("pipe.write('x'*70000);pipe.flush();time.sleep(60)\n")
        self.assertEqual(self.run_fake(command, load_timeout=2), 1)


class CombinedManifestTests(unittest.TestCase):
    def test_fixed_hash_and_paths_are_checked(self):
        import wave
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "sample.wav"
            with wave.open(str(audio), "wb") as wav:
                wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                wav.writeframes(b"\0\0" * 160)
            (root / "sample.txt").write_text("public fixture")
            entry = {"wav": "sample.wav", "reference": "sample.txt",
                     "sha256": hashlib.sha256(audio.read_bytes()).hexdigest()}
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"combined": entry}))
            args = argparse.Namespace(human_manifest=None, tts_directory=None, combined=audio)
            self.assertEqual(load_cases(args)[0]["sha256"], entry["sha256"])
            for change in ({"wav": "other.wav"}, {"reference": "other.txt"}, {"sha256": "0" * 64}):
                manifest.write_text(json.dumps({"combined": {**entry, **change}}))
                with self.assertRaisesRegex(ValueError, "combined_manifest_path_mismatch|audio_hash_mismatch"):
                    load_cases(args)


if __name__ == "__main__":
    unittest.main()
