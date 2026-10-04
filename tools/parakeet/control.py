"""Reproducible setup/start/stop/status without editing Mimi preferences."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
from auth import ensure_token, read_token

HERE = Path(__file__).resolve().parent


def report(event, **values):
    print(json.dumps({"event": event, **values}), flush=True)


def live(state):
    try:
        data = json.loads((state / "service.json").read_text())
        pid = data["pid"]
        if not isinstance(pid, int) or pid <= 1:
            return None
        command = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                                 text=True, capture_output=True, check=False).stdout
        expected = f"{HERE / 'bridge.py'} --model-dir {state / 'model'} --port {data['port']}"
        return data if expected in command and os.getpgid(pid) == pid else None
    except (OSError, ValueError, KeyError):
        return None


@contextmanager
def locked(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    with (state / "control.lock").open("a") as file:
        os.chmod(state / "control.lock", 0o600)
        fcntl.flock(file, fcntl.LOCK_EX)
        yield


def stop(state):
    data = live(state)
    if data:
        os.killpg(data["pid"], signal.SIGTERM)
        deadline = time.monotonic() + 4
        while live(state) and time.monotonic() < deadline:
            time.sleep(0.05)
        if live(state):
            os.killpg(data["pid"], signal.SIGKILL)
    (state / "service.json").unlink(missing_ok=True)
    report("stopped")


def main(args):
    state = args.state_dir.expanduser().resolve()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("requires_apple_silicon")
    if args.action in {"setup", "start"} and int(platform.mac_ver()[0].split(".")[0]) < 26:
        raise RuntimeError("pinned_mlx_requires_macos_26")
    with locked(state):
        if args.action == "status":
            data = live(state)
            report("status", running=data is not None, token_exists=(state / "bridge-token").is_file(), **(data or {}))
        elif args.action == "stop":
            stop(state)
        elif args.action == "setup":
            if live(state):
                raise RuntimeError("stop_before_setup")
            python = state / "venv/bin/python"
            if not python.exists():
                subprocess.run(["uv", "venv", "--python", "3.12", str(state / "venv")], check=True)
            subprocess.run(["uv", "pip", "sync", "--python", str(python), "--require-hashes",
                            str(HERE / "requirements.lock")], check=True)
            subprocess.run([str(python), str(HERE / "download.py"), str(state / "model")], check=True)
            ensure_token(state / "bridge-token")
        elif args.action == "start":
            if live(state):
                report("already_running")
                return
            python = state / "venv/bin/python"
            if not python.exists() or not (state / "model/mimi-manifest.json").exists():
                raise RuntimeError("run_setup_first")
            read_token(state / "bridge-token")
            if not 1024 <= args.port <= 65535:
                raise RuntimeError("invalid_port")
            log = state / "service.jsonl"
            log.write_text("")
            os.chmod(log, 0o600)
            process = subprocess.Popen([str(python), str(HERE / "bridge.py"), "--model-dir",
                                        str(state / "model"), "--port", str(args.port), "--log-file", str(log),
                                        "--token-file", str(state / "bridge-token")],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, start_new_session=True)
            state_file = state / "service.json"
            state_file.write_text(json.dumps({"pid": process.pid, "port": args.port}) + "\n")
            os.chmod(state_file, 0o600)
            deadline = time.monotonic() + 125
            try:
                while process.poll() is None and time.monotonic() < deadline:
                    if '"event":"listening"' in log.read_text():
                        report("started", pid=process.pid, port=args.port)
                        return
                    time.sleep(0.1)
            except BaseException:
                stop(state)
                raise
            stop(state)
            raise RuntimeError("start_failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["setup", "start", "stop", "status"])
    parser.add_argument("--state-dir", type=Path,
                        default=Path.home() / ".local/share/mimi-local-models/parakeet")
    parser.add_argument("--port", type=int, default=8767)
    try:
        main(parser.parse_args())
    except Exception as error:
        # Never include arbitrary subprocess output, paths or exception messages.
        code = str(error) if isinstance(error, RuntimeError) else "control_failed"
        report("error", code=code)
        sys.exit(1)
