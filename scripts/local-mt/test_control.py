#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import socket
import shlex
import subprocess
import sys
import tempfile
import time
import unittest

from control import checksum, private_write, require_free_ports, token, validate_model


class FileTests(unittest.TestCase):
    def test_existing_listener_is_rejected_before_backend_start(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, 'already_in_use'):
                require_free_ports({'port': port, 'backend_port': port})

    def test_partial_model_is_not_activated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'weights.part'
            path.write_bytes(b'short')
            with self.assertRaisesRegex(RuntimeError, 'wrong_size'):
                validate_model(path, {'size': 7, 'sha256': '0' * 64})
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                validate_model(path, {'size': 5, 'sha256': '0' * 64})
            self.assertTrue(path.exists())
            self.assertFalse(path.with_suffix('').exists())

    def test_tokens_are_private_not_symlinks_and_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'token'
            first = token(path)
            self.assertEqual(token(path), first)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            path.chmod(0o644)
            with self.assertRaises(RuntimeError):
                token(path)
            path.chmod(0o600)
            link = path.with_name('link')
            link.symlink_to(path)
            with self.assertRaises(OSError):
                token(link)

    def test_atomic_metadata_and_streaming_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'metadata'
            private_write(path, 'one')
            private_write(path, 'two')
            self.assertEqual(path.read_text(), 'two')
            self.assertEqual(checksum(path), hashlib.sha256(b'two').hexdigest())
            self.assertEqual(len(list(Path(directory).iterdir())), 1)


@unittest.skipUnless(os.name == 'posix', 'POSIX operator launcher')
class LifecycleTests(unittest.TestCase):
    def test_setup_free_start_repeated_start_stop_and_owned_backend_reap(self):
        # Tiny fake model/runtime; never downloads or invokes llama.cpp.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            interpreter = root / 'venv/bin/python'
            interpreter.parent.mkdir(parents=True)
            interpreter.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' "$@"\n')
            interpreter.chmod(0o700)
            model = root / 'models/fake.gguf'
            model.parent.mkdir()
            model.write_bytes(b'fake')
            ports = []
            for _ in range(2):
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0))
                    ports.append(sock.getsockname()[1])
            manifest = {'id': 'fixture', 'port': ports[0], 'backend_port': ports[1],
                        'filename': 'fake.gguf', 'size': 4, 'sha256': checksum(model),
                        'revision': 'fake', 'source_languages': ['en'],
                        'user_template': '{text}', 'generation': {'max_tokens': 1}}
            manifest_path = root / 'manifest.json'
            manifest_path.write_text(json.dumps(manifest))
            runtime = root / 'fake-runtime'
            runtime.write_text('#!' + sys.executable + '\n' + '''
import http.server,sys
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.end_headers();self.wfile.write(b'{"data":[{"id":"fixture"}]}')
http.server.HTTPServer(('127.0.0.1',int(sys.argv[sys.argv.index('--port')+1])),H).serve_forever()
''')
            runtime.chmod(0o700)
            script = str(Path(__file__).with_name('control.py'))
            def command(action):
                return subprocess.run([sys.executable, script, action, '--manifest', str(manifest_path),
                                       '--data-home', str(root), '--runtime', str(runtime)],
                                      capture_output=True, text=True, timeout=12)
            try:
                result = command('start')
                self.assertEqual(result.returncode, 0, result.stderr +
                                 (root / 'fixture/lifecycle.log').read_text())
                self.assertIn('Already ready', command('start').stdout)
                run = json.loads((root / 'fixture/run.json').read_text())
                self.assertEqual(command('status').returncode, 0)
                result = command('stop')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('reaped', result.stdout)
                with self.assertRaises(ProcessLookupError):
                    os.kill(run['backend_pid'], 0)
                self.assertEqual(command('status').returncode, 1)
                self.assertEqual(command('stop').returncode, 1)

                # Null/forged identity must never authorize a signal.
                owner_path = root / 'fixture/owner.json'
                owner_path.write_text(json.dumps({'pid': os.getpid(), 'identity': None,
                                                  'runtime': str(runtime)}))
                self.assertEqual(command('stop').returncode, 1)

                # Startup is cancellable before any health listener exists.
                backend_pid = root / 'loading.pid'
                runtime.write_text('#!' + sys.executable + '\nimport os,time,pathlib\n' +
                                   f'pathlib.Path({str(backend_pid)!r}).write_text(str(os.getpid()))\n' +
                                   'time.sleep(8)\n')
                pending = subprocess.Popen([sys.executable, script, 'start', '--manifest', str(manifest_path),
                                            '--data-home', str(root), '--runtime', str(runtime)],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                deadline = time.monotonic() + 4
                while not backend_pid.exists() and time.monotonic() < deadline:
                    time.sleep(0.03)
                self.assertTrue(backend_pid.exists())
                self.assertIn('Already starting', command('start').stdout)
                self.assertEqual(command('stop').returncode, 0)
                self.assertEqual(pending.wait(timeout=4), 1)
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(backend_pid.read_text()), 0)
            finally:
                command('stop')


if __name__ == '__main__':
    unittest.main()
