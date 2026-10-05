#!/usr/bin/env python3
"""Opt-in POSIX local MT lifecycle. Never starts at login or edits Mimi settings."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
DEFAULT_HOME = Path.home() / '.local/share/mimi-local-models'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def checksum(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError('private_directory_invalid')
    path.chmod(0o700)


def private_write(path, value):
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def token(path):
    if not path.exists():
        private_write(path, secrets.token_urlsafe(32))
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd) as source:
        mode = os.fstat(source.fileno())
        if not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o077 or mode.st_uid != os.getuid():
            raise RuntimeError('private_token_invalid')
        result = source.read(256).strip()
    if not 32 <= len(result) <= 128 or not result.isascii():
        raise RuntimeError('private_token_invalid')
    return result


def health(manifest):
    try:
        with OPENER.open(f"http://127.0.0.1:{manifest['port']}/health", timeout=1) as reply:
            value = json.loads(reply.read(4096))
        return value.get('model') == manifest['id'] and value.get('status') == 'ready'
    except (OSError, ValueError):
        return False


def serve_arguments(args):
    return [str(ROOT / 'control.py'), 'serve', '--manifest', str(args.manifest),
            '--data-home', str(args.data_home), '--runtime', str(args.runtime)]


def process_identity(pid, arguments):
    if type(pid) is not int or pid <= 1:
        return None
    try:
        line = subprocess.check_output(['ps', '-p', str(pid), '-o', 'uid=,lstart=,command='],
                                       text=True, timeout=1).strip()
        if (line.split()[0] == str(os.getuid()) and os.getpgid(pid) == pid
                and line.endswith(' ' + ' '.join(arguments))):
            # UID + birth timestamp + exact script/arguments, not PID alone.
            return line
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        pass
    return None


def listener_owned(pid, port):
    executable = shutil.which('lsof')
    if executable is None and Path('/usr/sbin/lsof').is_file():
        executable = '/usr/sbin/lsof'
    if executable is None:
        raise RuntimeError('lsof_required_for_listener_identity')
    result = subprocess.run([executable, '-nP', '-a', '-p', str(pid),
                             '-iTCP@127.0.0.1:' + str(port), '-sTCP:LISTEN', '-Fn'],
                            text=True, capture_output=True, timeout=2)
    lines = result.stdout.splitlines()
    return result.returncode == 0 and f'p{pid}' in lines and f'n127.0.0.1:{port}' in lines


def owner(args, manifest):
    try:
        data = json.loads((args.data_home / manifest['id'] / 'owner.json').read_text())
        if not isinstance(data.get('identity'), str) or not data['identity']:
            return None
        # Runtime is recorded by the owner so stop/status need no --runtime.
        arguments = [str(ROOT / 'control.py'), 'serve', '--manifest', str(args.manifest),
                     '--data-home', str(args.data_home), '--runtime', data['runtime']]
        return data if process_identity(data['pid'], arguments) == data['identity'] else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def ready(args, manifest):
    data = owner(args, manifest)
    return bool(data and listener_owned(data['pid'], manifest['port']) and health(manifest))


def require_free_ports(manifest):
    for port in (manifest['port'], manifest['backend_port']):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', port))
            except OSError:
                raise RuntimeError('local_model_port_already_in_use') from None


def inference_running(data_home):
    import fcntl
    fd = os.open(data_home / 'inference.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return False
    except BlockingIOError:
        return True
    finally:
        os.close(fd)


def validate_model(path, manifest):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != manifest['size']:
        raise RuntimeError('model_missing_or_wrong_size_run_setup')
    if checksum(path) != manifest['sha256']:
        raise RuntimeError('model_checksum_mismatch')


def setup(args, manifest):
    if sys.version_info < (3, 10):
        raise RuntimeError('setup_requires_python_3_10_or_newer')
    private_directory(args.data_home)
    models = args.data_home / 'models'
    private_directory(models)
    destination = models / manifest['filename']
    if not destination.exists():
        part = destination.with_suffix(destination.suffix + '.part')
        if part.is_symlink():
            raise RuntimeError('download_path_invalid')
        url = (f"https://huggingface.co/{manifest['repository']}/resolve/"
               f"{manifest['revision']}/{manifest['filename']}")
        subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--continue-at', '-',
                        '--output', str(part), url], check=True)
        validate_model(part, manifest)
        part.chmod(0o600)
        os.replace(part, destination)
    validate_model(destination, manifest)
    venv = args.data_home / 'venv'
    if not (venv / 'bin/python').exists():
        subprocess.run([sys.executable, '-m', 'venv', str(venv)], check=True)
    subprocess.run([str(venv / 'bin/python'), '-m', 'pip', 'install', '-r',
                    str(ROOT / 'requirements.txt')], check=True)
    print('Model SHA256 verified; isolated runtime dependencies ready. No service started.')


def llama_command(runtime, model, manifest, token_path, template_path=None):
    command = [str(runtime), '--model', str(model), '--alias', manifest['id'],
            '--host', '127.0.0.1', '--port', str(manifest['backend_port']),
            '--ctx-size', '2048', '--parallel', '1', '--cache-ram', '0',
            '--n-predict', '256', '--jinja', '--no-context-shift', '--no-slots',
            '--no-webui', '--api-key-file', str(token_path), '--log-disable']
    if template_path is not None:
        command.extend(['--chat-template-file', str(template_path)])
    return command


async def serve(args, manifest):
    import fcntl
    import aiohttp
    from aiohttp import web
    from gateway import create_app, quiet_logging

    quiet_logging()
    private_directory(args.data_home)
    state = args.data_home / manifest['id']
    private_directory(state)
    # One model for this tool across all candidates. Index/other applications
    # are independent: the operator must stop them before starting this tool.
    lock_fd = os.open(args.data_home / 'inference.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock_fd)
        raise RuntimeError('another_local_mt_model_is_running') from None
    process = None
    runner = None
    shutdown = asyncio.Event()
    for event in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(event, shutdown.set)
    try:
        identity = process_identity(os.getpid(), serve_arguments(args))
        if not identity:
            raise RuntimeError('controller_identity_unavailable')
        private_write(state / 'owner.json', json.dumps({
            'pid': os.getpid(), 'runtime': str(args.runtime),
            'identity': identity}) + '\n')
        require_free_ports(manifest)
        model = args.data_home / 'models' / manifest['filename']
        validate_model(model, manifest)
        backend_token = token(state / 'backend.token')
        template = manifest.get('chat_template_file')
        template_path = args.manifest.parent / template if template else None
        command = llama_command(args.runtime, model, manifest, state / 'backend.token', template_path)
        environment = {key: value for key, value in os.environ.items()
                       if key in ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL')}
        process = await asyncio.create_subprocess_exec(
            *command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, env=environment)
        limit = time.monotonic() + 60
        async with aiohttp.ClientSession(trust_env=False, timeout=aiohttp.ClientTimeout(total=1),
                                         headers={'Authorization': 'Bearer ' + backend_token}) as client:
            while time.monotonic() < limit and not shutdown.is_set():
                if process.returncode is not None:
                    raise RuntimeError('llama_backend_exited_during_start')
                try:
                    if not listener_owned(process.pid, manifest['backend_port']):
                        await asyncio.sleep(0.2)
                        continue
                    async with client.get(f"http://127.0.0.1:{manifest['backend_port']}/v1/models") as reply:
                        data = await reply.content.read(8193)
                        values = json.loads(data) if len(data) <= 8192 else {}
                        matches = any(item.get('id') == manifest['id'] for item in values.get('data', []))
                        if reply.status == 200 and matches and process.returncode is None:
                            break
                except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
                    pass
                await asyncio.sleep(0.2)
            else:
                raise RuntimeError('llama_backend_start_timeout')
        if shutdown.is_set():
            return
        app = create_app(manifest, backend_token)
        # Cancelling a disconnected handler closes the upstream HTTP request;
        # llama.cpp can then release that generation instead of filling a queue.
        runner = web.AppRunner(app, access_log=None, handler_cancellation=True,
                               keepalive_timeout=5, shutdown_timeout=1,
                               max_line_size=4096, max_field_size=4096)
        await runner.setup()
        await web.TCPSite(runner, '127.0.0.1', manifest['port'], backlog=8).start()
        private_write(state / 'run.json', json.dumps({
            'pid': os.getpid(), 'backend_pid': process.pid,
            'model_sha256': manifest['sha256'], 'model_revision': manifest['revision'],
            'runtime_sha256': checksum(args.runtime), 'started_unix': time.time()}) + '\n')
        print('ready', flush=True)
        stopping = asyncio.create_task(shutdown.wait())
        backend_exit = asyncio.create_task(process.wait())
        _, pending = await asyncio.wait([stopping, backend_exit], return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
    finally:
        if runner:
            await runner.cleanup()
        if process and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 3)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
        os.close(lock_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'start', 'stop', 'status', 'preset', 'serve'])
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--data-home', type=Path, default=DEFAULT_HOME)
    parser.add_argument('--runtime', type=Path)
    args = parser.parse_args()
    args.manifest = args.manifest.resolve()
    args.data_home = args.data_home.expanduser().resolve()
    manifest = json.loads(args.manifest.read_text())
    if os.name != 'posix':
        parser.error('This operator launcher currently supports macOS/Linux only')
    if args.action == 'setup':
        setup(args, manifest)
    elif args.action == 'preset':
        print(json.dumps({'type': 'OpenAI-compatible', 'endpoint': f"http://127.0.0.1:{manifest['port']}/v1",
                          'model': manifest['id'], 'apiKey': '', 'proxy': 'direct',
                          'sourceLanguage': 'explicit; automatic is unsupported'}, indent=2))
    elif args.action == 'status':
        available = ready(args, manifest)
        print('ready' if available else 'stopped or unavailable')
        return 0 if available else 1
    elif args.action == 'stop':
        data = owner(args, manifest)
        if not data:
            print('No verified owned controller; no unrelated PID was signalled.')
            return 1
        os.kill(data['pid'], signal.SIGTERM)
        for _ in range(30):
            if not owner(args, manifest) and not inference_running(args.data_home):
                print('Adapter stopped and its owned backend reaped.')
                return 0
            time.sleep(0.2)
        raise RuntimeError('stop_timeout')
    else:
        if not args.runtime or not args.runtime.expanduser().is_file():
            parser.error('--runtime must name an existing llama-server binary (b11146 tested)')
        args.runtime = args.runtime.expanduser().resolve()
        if args.action == 'serve':
            asyncio.run(serve(args, manifest))
        elif ready(args, manifest):
            print('Already ready.')
        elif owner(args, manifest):
            print('Already starting; use status to check readiness.')
        else:
            python = args.data_home / 'venv/bin/python'
            if not python.is_file():
                raise RuntimeError('run_setup_first')
            state = args.data_home / manifest['id']
            private_directory(state)
            log_fd = os.open(state / 'lifecycle.log', os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
            with os.fdopen(log_fd, 'w') as log:
                child = subprocess.Popen([str(python), *serve_arguments(args)], stdin=subprocess.DEVNULL,
                                         stdout=log, stderr=log, start_new_session=True)
            for _ in range(320):
                if ready(args, manifest):
                    print(f"Ready: http://127.0.0.1:{manifest['port']}/v1 ({manifest['id']})")
                    return 0
                if child.poll() is not None:
                    raise RuntimeError('local_service_start_failed_see_content_free_lifecycle_log')
                time.sleep(0.2)
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # The only PID signalled is our current Popen child, never a
                # stale PID loaded from disk or a process matched by name.
                child.kill()
                child.wait()
            raise RuntimeError('local_service_start_timeout')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
        # Fixed labels, not exception bodies from HTTP, model or transcript data.
        label = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print('Local MT: ' + label, file=sys.stderr)
        sys.exit(1)
