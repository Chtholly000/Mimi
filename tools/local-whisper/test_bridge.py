import asyncio
import contextlib
import json
from pathlib import Path
import struct
import tempfile
import unittest

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import InvalidStatus

from bridge import Bridge, Failure, FRAME, MAX_SEGMENT, MODEL, Segmenter, Session, Worker, load_token

TOKEN = "synthetic-test-token-not-a-real-credential"
VOICE = struct.pack("<h", 1000) * 320
QUIET = bytes(FRAME)


def start(task="test", language="en"):
    return json.dumps({"header": {"action": "run-task", "task_id": task, "streaming": "duplex"},
                       "payload": {"task_group": "audio", "task": "asr", "function": "recognition",
                                   "model": MODEL, "parameters": {"format": "pcm", "sample_rate": 16000,
                                                                   "language_hints": [language]}}})


def finish(task="test"):
    return json.dumps({"header": {"action": "finish-task", "task_id": task, "streaming": "duplex"}})


class FakeWorker:
    def __init__(self):
        self.failed = asyncio.Event()
        self.requests = []
        self.delay = 0
        self.fail = False

    async def infer(self, pcm, language):
        self.requests.append((len(pcm), language))
        await asyncio.sleep(self.delay)
        if self.fail:
            raise Failure("fake_failure_with_secret_must_not_escape")
        return f"Synthetic {language} result"


class SegmentationTests(unittest.TestCase):
    def test_silence_and_partial_buffer_stay_bounded(self):
        gate = Segmenter()
        for _ in range(2000):
            self.assertEqual(list(gate.push(QUIET)), [])
        self.assertLessEqual(len(gate.preroll), 15)
        self.assertEqual(list(gate.finish()), [])

    def test_draft_final_and_continuous_eight_second_bound(self):
        gate = Segmenter()
        events = []
        for _ in range(900):
            events.extend(gate.push(VOICE))
        events.extend(gate.finish())
        finals = [e for e in events if e[2]]
        self.assertEqual([e[0] for e in finals], [1, 2, 3])
        self.assertTrue(all(len(e[1]) <= MAX_SEGMENT for e in events))
        self.assertEqual(sum(len(e[1]) for e in finals), 900 * FRAME)

    def test_silence_finalizes_and_eof_keeps_partial(self):
        gate = Segmenter()
        self.assertEqual(list(gate.push(VOICE[:320])), [])
        result = list(gate.finish())
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0][2])
        gate = Segmenter()
        result = list(gate.push(VOICE + QUIET * 30))
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0][2])

    def test_bad_audio_rejected(self):
        for pcm in (b"", b"x", bytes(128 * 1024 + 2)):
            with self.assertRaises(Failure):
                list(Segmenter().push(pcm))

    def test_pending_finals_fail_instead_of_dropping(self):
        session = Session(None, None)
        session.enqueue((1, VOICE, True))
        session.enqueue((2, VOICE, True))
        with self.assertRaises(Failure):
            session.enqueue((3, VOICE, True))

    def test_latest_preview_replaces_old_and_final_retires_it(self):
        session = Session(None, None)
        session.enqueue((1, VOICE, False))
        session.enqueue((1, VOICE * 2, False))
        self.assertEqual(len(session.draft[1]), FRAME * 2)
        session.enqueue((1, VOICE * 3, True))
        self.assertIsNone(session.draft)

    def test_private_token_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token"
            path.write_text(TOKEN)
            path.chmod(0o600)
            self.assertEqual(load_token(path), TOKEN)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                load_token(link)
            path.chmod(0o644)
            with self.assertRaises(Failure):
                load_token(path)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.worker = FakeWorker()
        self.bridge = Bridge(self.worker, TOKEN)
        self.server = await serve(self.bridge.handler, "127.0.0.1", 0,
                                  process_request=self.bridge.authenticate,
                                  max_size=128 * 1024, max_queue=4, compression=None)
        self.url = f"ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}/asr"

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        await asyncio.gather(*self.bridge.reservations, return_exceptions=True)
        self.assertEqual(self.bridge.connections, set())

    def connect(self, **kwargs):
        return connect(self.url, additional_headers={"Authorization": "Bearer " + TOKEN}, **kwargs)

    async def test_auth_origin_and_path_rejected(self):
        for url, headers, code in [
            (self.url, {}, 401),
            (self.url, {"Authorization": "Bearer wrong"}, 401),
            (self.url, {"Authorization": "Bearer " + TOKEN, "Origin": "https://example.com"}, 403),
            (self.url + "?token=not-supported", {"Authorization": "Bearer " + TOKEN}, 404),
        ]:
            with self.assertRaises(InvalidStatus) as raised:
                async with connect(url, additional_headers=headers):
                    pass
            self.assertEqual(raised.exception.response.status_code, code)

    async def test_empty_session_and_ping_are_not_recognition(self):
        async with self.connect() as ws:
            await ws.send(start())
            self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-started")
            pong = await ws.ping()
            await asyncio.wait_for(pong, 1)
            await ws.send(finish())
            self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-finished")
        self.assertEqual(self.worker.requests, [])

    async def test_two_sessions_are_isolated_and_third_is_busy(self):
        async with self.connect() as first, self.connect() as second:
            with self.assertRaises(InvalidStatus) as raised:
                async with self.connect():
                    pass
            self.assertEqual(raised.exception.response.status_code, 503)
            for ws, task, language in [(first, "a", "en"), (second, "b", "ja")]:
                await ws.send(start(task, language))
                await ws.recv()
                await ws.send(VOICE * 5)
                await ws.send(finish(task))
            for ws, task, language in [(first, "a", "en"), (second, "b", "ja")]:
                result = json.loads(await ws.recv())
                self.assertEqual(result["header"]["task_id"], task)
                self.assertEqual(result["payload"]["output"]["sentence"], {
                    "sentence_id": 1, "text": f"Synthetic {language} result", "sentence_end": True})
                self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-finished")

    async def test_invalid_language_configuration_and_odd_pcm_fail_safely(self):
        for raw, pcm in [(start(language="xx"), None), (start().replace(MODEL, "wrong"), None),
                         (start(), b"x")]:
            async with self.connect() as ws:
                await ws.send(raw)
                value = json.loads(await ws.recv())
                if pcm is not None:
                    await ws.send(pcm)
                    value = json.loads(await ws.recv())
                self.assertEqual(value["header"]["event"], "task-failed")
                self.assertEqual(value["header"]["error_message"], "local_asr_failed")

    async def test_disconnect_discards_inflight_result_and_releases_slot(self):
        self.worker.delay = 0.05
        async with self.connect() as ws:
            await ws.send(start())
            await ws.recv()
            await ws.send(VOICE * 100)
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.07)
        self.assertFalse(self.bridge.handling)
        async with self.connect() as ws:
            await ws.send(start("new"))
            await ws.recv()
            await ws.send(finish("new"))
            self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-finished")

    async def test_worker_errors_are_sanitized(self):
        self.worker.fail = True
        async with self.connect() as ws:
            await ws.send(start())
            await ws.recv()
            await ws.send(VOICE)
            await ws.send(finish())
            result = await ws.recv()
            self.assertNotIn("secret", result)
            self.assertEqual(json.loads(result)["header"]["event"], "task-failed")


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_subprocess_idle_exit_is_detected_and_close_reaps(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fake-worker"
            path.write_text('#!/usr/bin/env python3\nimport time\nprint(\'{"event":"ready","load_ms":1}\', flush=True)\ntime.sleep(0.05)\n')
            path.chmod(0o700)
            worker = Worker(path, "unused")
            await worker.start()
            await asyncio.wait_for(worker.failed.wait(), 2)
            await worker.close()
            self.assertIsNotNone(worker.proc.returncode)

    async def test_real_subprocess_shutdown_does_not_leave_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fake-worker"
            path.write_text('#!/usr/bin/env python3\nimport time\nprint(\'{"event":"ready","load_ms":1}\', flush=True)\ntime.sleep(60)\n')
            path.chmod(0o700)
            worker = Worker(path, "unused")
            await worker.start()
            await worker.close()
            self.assertIsNotNone(worker.proc.returncode)

    async def test_cancelled_request_does_not_desynchronize_shared_worker(self):
        class Input:
            def write(self, data):
                pass
            async def drain(self):
                pass
        class Process:
            stdin = Input()
        worker = Worker("unused", "unused")
        worker.proc = Process()
        returned = 0
        async def read():
            nonlocal returned
            await asyncio.sleep(0.03)
            returned += 1
            return {"event": "result", "text": str(returned)}
        worker.read = read
        first = asyncio.create_task(worker.infer(VOICE, "en"))
        await asyncio.sleep(0.01)
        first.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await first
        self.assertEqual(await worker.infer(VOICE, "ja"), "2")
        self.assertFalse(worker.failed.is_set())
        self.assertFalse(worker.pending)


if __name__ == "__main__":
    unittest.main()
