#!/usr/bin/env python3
"""Verify the launchd job, its process and exact listener; never read process env."""
import argparse
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

ROOT = Path.home() / ".local/share/mimi-local-models/whisper"
JOB = f"gui/{os.getuid()}/local.mimi-whisper"
ARGS = [str(ROOT / "venv/bin/python3"), "-u", str(ROOT / "bridge.py"),
        "--worker", str(ROOT / "mimi-whisper-worker"),
        "--model", str(ROOT / "ggml-large-v3-turbo-q5_0.bin"),
        "--token-file", str(ROOT / "bridge-token"), "--port", "18082"]


def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)


def identity():
    status = run(["/bin/launchctl", "print", JOB])
    if status.returncode:
        return None, None
    text = status.stdout
    path = re.search(r"^\s*path = (.+)$", text, re.M)
    program = re.search(r"^\s*program = (.+)$", text, re.M)
    arguments = re.search(r"^\s*arguments = \{\n(.*?)^\s*\}", text, re.M | re.S)
    if (not path or path.group(1) != str(ROOT / "service.plist")
            or not program or program.group(1) != ARGS[0] or not arguments
            or [s.strip() for s in arguments.group(1).splitlines() if s.strip()] != ARGS):
        raise RuntimeError("job_identity_mismatch")
    pid = re.search(r"^\s*pid = (\d+)$", text, re.M)
    if pid is None:
        return True, None
    pid = int(pid.group(1))
    live = run(["/bin/ps", "-ww", "-p", str(pid), "-o", "command="])
    command = shlex.split(live.stdout.strip())
    # Python may resolve its executable symlink, but every script argument must match.
    if pid < 2 or live.returncode or not command or command[1:] != ARGS[1:]:
        raise RuntimeError("process_identity_mismatch")
    return True, pid


def listening(pid):
    if not pid:
        return False
    value = run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"])
    listener_matches = value.returncode == 0 and {
        line[1:] for line in value.stdout.splitlines() if line.startswith("n")
    } == {"127.0.0.1:18082"}
    # The bridge binds only after model-ready; also require its exact worker child.
    processes = run(["/bin/ps", "-axo", "pid=,ppid="])
    children = [parts[0] for line in processes.stdout.splitlines()
                if len(parts := line.split()) == 2 and parts[1] == str(pid)]
    if not listener_matches or processes.returncode or len(children) != 1:
        return False
    child = run(["/bin/ps", "-ww", "-p", children[0], "-o", "command="])
    worker = [str(ROOT / "mimi-whisper-worker"), str(ROOT / "ggml-large-v3-turbo-q5_0.bin")]
    return child.returncode == 0 and shlex.split(child.stdout.strip()) == worker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "stop", "status"), default="status", nargs="?")
    action = parser.parse_args().action
    if Path(__file__).resolve().parent != ROOT:
        raise RuntimeError("run_installed_control")
    exists, pid = identity()
    if action == "stop":
        if exists:
            result = run(["/bin/launchctl", "bootout", JOB])
            if result.returncode:
                raise RuntimeError("stop_failed")
            if pid:
                for _ in range(50):
                    if run(["/bin/ps", "-p", str(pid), "-o", "pid="]).returncode:
                        break
                    time.sleep(0.1)
                else:
                    raise RuntimeError("stop_not_confirmed")
        print("Whisper service stopped. Other local services were not changed.")
        return 0
    if action == "start":
        if exists and not pid:
            raise RuntimeError("job_exited_stop_then_start")
        if not exists:
            result = run(["/bin/launchctl", "bootstrap", f"gui/{os.getuid()}", str(ROOT / "service.plist")])
            if result.returncode:
                raise RuntimeError("start_failed")
        for _ in range(60):
            _, pid = identity()
            if listening(pid):
                break
            time.sleep(1)
    if listening(pid):
        print(f"Whisper worker loaded; verified bridge PID {pid}: ws://127.0.0.1:18082/asr")
        print("Recognition quality and Mimi capture/overlay are separate checks.")
        return 0
    print("Whisper stopped, still loading, or its listener could not be verified.")
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        # These labels are from this inspector; no service output or credentials.
        print("Whisper control failed; inspect installation and job identity.")
        raise SystemExit(1) from None
