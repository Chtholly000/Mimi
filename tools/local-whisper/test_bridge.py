import asyncio
import contextlib
import json
from pathlib import Path
import signal
import struct
import tempfile
from types import SimpleNamespace
import unittest
import wave
from unittest.mock import AsyncMock, patch

from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import InvalidStatus

from bridge import Bridge, Failure, FRAME, MAX_SEGMENT, MODEL, Segmenter, Session, Worker, load_token
import bridge
from benchmark import ReplayFailure, failure_record, replay
import status

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

    async def infer(self, pcm, language, *, is_current=lambda: True):
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

    def test_short_sentence_gaps_finalize_before_the_eight_second_cut(self):
        gate = Segmenter()
        events = []
        for voiced, silence in [(90, 15), (114, 11), (117, 12), (100, 10)]:
            for _ in range(voiced):
                events.extend(gate.push(VOICE))
            for _ in range(silence):
                events.extend(gate.push(QUIET))
        self.assertEqual([event[0] for event in events if event[2]], [1, 2, 3, 4])

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
        return connect(self.url, additional_headers={"Authorization": "Bearer " + TOKEN}, proxy=None, **kwargs)

    async def test_auth_origin_and_path_rejected(self):
        for url, headers, code in [
            (self.url, {}, 401),
            (self.url, {"Authorization": "Bearer wrong"}, 401),
            (self.url, {"Authorization": "Bearer " + TOKEN, "Origin": "https://example.com"}, 403),
            (self.url + "?token=not-supported", {"Authorization": "Bearer " + TOKEN}, 404),
        ]:
            with self.assertRaises(InvalidStatus) as raised:
                async with connect(url, additional_headers=headers, proxy=None):
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

    async def test_mimi_audio3_encoder_context_and_automatic_language(self):
        # Exact wire shape from Audio3ASRRequestEncoder::run_task_for_model,
        # including context always supplied by audio3_client::connect_with_heartbeat.
        for language in ("en", "auto", "ja"):
            payload = json.loads(start(language=language))
            parameters = payload["payload"]["parameters"]
            parameters.update(semantic_punctuation_enabled=True, heartbeat=True)
            if language == "auto":
                del parameters["language_hints"]
                context = ("Natural audiovisual dialogue, including interjections, breaths, "
                           "gasps, moans, cries, laughter, and other vocalizations.")
            else:
                context = ("Natural English audiovisual dialogue, including interjections, "
                           "hesitations, breaths, gasps, moans, cries, laughter, and other vocalizations.")
            payload["payload"]["input"] = {"context": [
                {"role": "user", "content": [{"type": "input_text", "text": context}]}]}
            async with self.connect() as ws:
                await ws.send(json.dumps(payload))
                self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-started")
                await ws.send(VOICE)
                await ws.send(finish())
                result = json.loads(await ws.recv())
                self.assertEqual(result["payload"]["output"]["sentence"]["text"],
                                 f"Synthetic {language} result")
                self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-finished")
        self.assertEqual([language for _, language in self.worker.requests], ["en", "auto", "ja"])

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
        for raw, pcm, label in [
            (start(language="xx"), None, "language_unsupported"),
            (start().replace(MODEL, "wrong"), None, "configuration_invalid"),
            (start(), b"x", "audio_invalid"),
        ]:
            async with self.connect() as ws:
                await ws.send(raw)
                value = json.loads(await ws.recv())
                if pcm is not None:
                    await ws.send(pcm)
                    value = json.loads(await ws.recv())
                self.assertEqual(value["header"]["event"], "task-failed")
                self.assertEqual(value["header"]["error_message"], "local_asr_" + label)

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

    async def test_slow_worker_reports_bounded_final_backlog(self):
        self.worker.delay = 0.2
        async with self.connect() as ws:
            await ws.send(start(language="ja"))
            await ws.recv()
            # Four short complete segments arrive while one is decoding. The
            # two-final queue fails explicitly rather than losing an old final.
            for _ in range(4):
                await ws.send(VOICE + QUIET * 10)
            header = json.loads(await ws.recv())["header"]
            self.assertEqual(header["event"], "task-failed")
            self.assertEqual(header["error_code"], "LOCAL_ASR_OVERLOADED")
            self.assertEqual(header["error_message"], "local_asr_final_backlog")

    async def test_empty_finals_retract_previews_and_next_sentence_continues(self):
        outputs = iter(["Preview one", "", "Preview two", "", "Confirmed third"])
        async def infer(_pcm, _language, **_kwargs):
            return next(outputs)
        self.worker.infer = infer
        async with self.connect() as ws:
            await ws.send(start(language="ja"))
            await ws.recv()
            for sentence_id in (1, 2):
                await ws.send(VOICE * 100)
                draft = json.loads(await ws.recv())["payload"]["output"]["sentence"]
                self.assertFalse(draft["sentence_end"])
                self.assertEqual(draft["sentence_id"], sentence_id)
                await ws.send(QUIET * 10)
                final = json.loads(await ws.recv())["payload"]["output"]["sentence"]
                self.assertEqual(final, {"sentence_id": sentence_id, "sentence_end": True, "text": ""})
                boundary = json.loads(await ws.recv())["payload"]["output"]["sentence"]
                self.assertEqual(boundary, {"sentence_id": sentence_id + 1, "sentence_begin": True,
                                            "sentence_end": False, "text": ""})
            await ws.send(VOICE)
            await ws.send(finish())
            final = json.loads(await ws.recv())["payload"]["output"]["sentence"]
            self.assertEqual(final, {"sentence_id": 3, "sentence_end": True, "text": "Confirmed third"})
            self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-finished")

    async def test_empty_final_without_preview_finishes_normally(self):
        self.worker.infer = AsyncMock(return_value="")
        async with self.connect() as ws:
            await ws.send(start(language="ja"))
            await ws.recv()
            await ws.send(VOICE)
            await ws.send(finish())
            self.assertEqual(json.loads(await ws.recv())["header"]["event"], "task-finished")


class FailureEvidenceTests(unittest.TestCase):
    def test_unknown_exception_cannot_leak_and_known_boundary_is_preserved(self):
        self.assertEqual(bridge.failure_message(Failure("private secret")), "local_asr_failed")
        self.assertEqual(bridge.failure_message(RuntimeError("private secret")), "local_asr_failed")
        self.assertEqual(bridge.failure_message(Failure("final_backlog")), "local_asr_final_backlog")
        self.assertEqual(bridge.failure_message(TimeoutError()), "local_asr_timeout")

    def test_only_exact_local_boundaries_get_actionable_codes(self):
        for label in ("final_backlog", "worker_busy"):
            self.assertEqual(bridge.failure_code(bridge.failure_message(Failure(label))),
                             "LOCAL_ASR_OVERLOADED")
        for error in (Failure("worker_timeout"), Failure("finish_timeout"), TimeoutError()):
            self.assertEqual(bridge.failure_code(bridge.failure_message(error)), "LOCAL_ASR_TIMEOUT")
        self.assertEqual(bridge.failure_code(bridge.failure_message(Failure("language_unsupported"))),
                         "UNSUPPORTED_LANGUAGE")
        self.assertEqual(bridge.failure_code("local_asr_final_backlog private secret"), "SERVER_ERROR")

    def test_replay_failure_keeps_preceding_fixture_events_and_sanitizes_header(self):
        events = [{"text": "explicit synthetic fixture", "sentence_end": True}]
        error = ReplayFailure("recognition_failed", {
            "error_code": "SERVER_ERROR", "error_message": "local_asr_final_backlog"}, events)
        record = failure_record(error, sample="synthetic.wav")
        self.assertEqual(record["error_message"], "local_asr_final_backlog")
        self.assertEqual(record["events"], events)
        events.clear()
        self.assertEqual(len(record["events"]), 1)
        untrusted = ReplayFailure("recognition_failed", {
            "error_code": "private secret", "error_message": "private secret"}, [])
        self.assertEqual(failure_record(untrusted)["error_message"], "local_asr_failed")
        self.assertIsNone(untrusted.error_code)


class ReplayEvidenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_closed_failed_replay_preserves_safe_code_and_earlier_final(self):
        async def handler(ws):
            request = json.loads(await ws.recv())
            task = request["header"]["task_id"]
            await ws.send(json.dumps({"header": {"event": "task-started", "task_id": task}}))
            await ws.recv()
            await ws.send(json.dumps({"header": {"event": "result-generated", "task_id": task},
                                      "payload": {"output": {"sentence": {
                                          "sentence_id": 1, "sentence_end": True,
                                          "text": "Synthetic public fixture"}}}}))
            await ws.send(json.dumps({"header": {"event": "task-failed", "task_id": task,
                                      "error_code": "LOCAL_ASR_OVERLOADED",
                                      "error_message": "local_asr_final_backlog"}}))
            await ws.close()
        with tempfile.TemporaryDirectory() as directory:
            wav = Path(directory) / "fixture.wav"
            reference = Path(directory) / "fixture.txt"
            reference.write_text("Synthetic public fixture")
            with wave.open(str(wav), "wb") as audio:
                audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                audio.writeframes(VOICE * 10)
            async with serve(handler, "127.0.0.1", 0) as server:
                port = server.sockets[0].getsockname()[1]
                with self.assertRaises(ReplayFailure) as raised:
                    await replay(f"ws://127.0.0.1:{port}/asr", TOKEN, wav, reference, language="ja")
            record = failure_record(raised.exception)
            self.assertEqual(record["error_code"], "LOCAL_ASR_OVERLOADED")
            self.assertEqual(record["error_message"], "local_asr_final_backlog")
            self.assertEqual(len(record["events"]), 1)
            self.assertTrue(record["events"][0]["sentence_end"])


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_timeout_is_a_static_failure_and_retires_worker(self):
        worker = Worker("unused", "unused")
        worker.proc = SimpleNamespace(stdin=SimpleNamespace(write=lambda _: None, drain=AsyncMock()))
        worker.read = AsyncMock(side_effect=TimeoutError())
        with self.assertRaisesRegex(Failure, "^worker_timeout$"):
            await worker.infer(VOICE, "ja")
        self.assertTrue(worker.failed.is_set())

    async def test_retired_preview_waiting_for_lock_does_not_run_inference(self):
        worker = Worker("unused", "unused")
        current = True
        await worker.lock.acquire()
        request = asyncio.create_task(worker.infer(VOICE, "en", is_current=lambda: current))
        await asyncio.sleep(0)
        current = False
        worker.lock.release()
        # No process exists: touching its pipes would fail this regression.
        self.assertIsNone(await request)
        self.assertFalse(worker.failed.is_set())

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


class ServiceLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_failure_exits_with_error_but_explicit_stop_is_success(self):
        loop = asyncio.get_running_loop()
        for failed in (False, True):
            handlers = {}
            worker = SimpleNamespace(failed=asyncio.Event(), close=AsyncMock())
            async def started():
                loop.call_later(0.02, worker.failed.set if failed else handlers[signal.SIGTERM])
            worker.start = AsyncMock(side_effect=started)
            args = SimpleNamespace(worker="unused", model="unused", token_file="unused", port=0)
            with patch("bridge.Worker", return_value=worker), \
                 patch("bridge.load_token", return_value=TOKEN), \
                 patch.object(loop, "add_signal_handler", side_effect=lambda sig, callback: handlers.update({sig: callback})):
                if failed:
                    with self.assertRaisesRegex(Failure, "worker_failed"):
                        await bridge.main(args)
                else:
                    await bridge.main(args)
            worker.close.assert_awaited_once()


class ControlIdentityTests(unittest.TestCase):
    def command(self, args):
        if args[0] == "/bin/launchctl":
            value = (f"path = {status.ROOT / 'service.plist'}\nprogram = {status.ARGS[0]}\n"
                     + "arguments = {\n" + "\n".join(status.ARGS) + "\n}\npid = 123\n")
        elif args[0] == "/usr/sbin/lsof":
            value = "p123\nn127.0.0.1:18082\n"
        elif "-axo" in args:
            value = "456 123\n"
        elif "456" in args:
            value = f"{status.ROOT / 'mimi-whisper-worker'} {status.ROOT / 'ggml-large-v3-turbo-q5_0.bin'}\n"
        else:
            value = " ".join(status.ARGS)
        return SimpleNamespace(returncode=0, stdout=value)

    def test_exact_job_process_listener_and_worker_match(self):
        with patch("status.run", self.command):
            self.assertEqual(status.identity(), (True, 123))
            self.assertTrue(status.listening(123))

    def test_wrong_job_and_reused_pid_are_not_accepted(self):
        for kind in ("/bin/launchctl", "/bin/ps"):
            def command(args):
                result = self.command(args)
                if args[0] == kind:
                    result.stdout = result.stdout.replace("bridge.py", "other.py")
                return result
            with patch("status.run", command), self.assertRaises(RuntimeError):
                status.identity()

    def test_verified_launchd_proxy_is_starting_but_wrong_proxy_is_rejected(self):
        for proxy in ("xpcproxy local.mimi-whisper", "/usr/libexec/xpcproxy local.mimi-whisper",
                      "xpcproxy other-job", "other-process local.mimi-whisper"):
            def command(args):
                result = self.command(args)
                if args[0] == "/bin/launchctl":
                    result.stdout += "state = xpcproxy\n"
                elif args[0] == "/bin/ps":
                    result.stdout = proxy
                return result
            with patch("status.run", command), self.assertRaises(RuntimeError) as raised:
                status.identity()
            self.assertEqual(isinstance(raised.exception, status.Starting),
                             proxy in ("xpcproxy local.mimi-whisper",
                                       "/usr/libexec/xpcproxy local.mimi-whisper"))

    def test_start_polls_verified_proxy_until_full_identity_and_listener(self):
        with patch("status.__file__", str(status.ROOT / "status.py")), \
             patch("sys.argv", ["status.py", "start"]), \
             patch("status.identity", side_effect=[(None, None), status.Starting(), (True, 123)]), \
             patch("status.listening", side_effect=[False, True, True]), \
             patch("status.run", self.command), patch("status.time.sleep"), patch("builtins.print"):
            self.assertEqual(status.main(), 0)

    def test_wildcard_extra_listener_or_missing_worker_are_not_ready(self):
        for output, command_name in [("p123\nn*:18082\n", "/usr/sbin/lsof"),
                                     ("p123\nn127.0.0.1:18082\nn127.0.0.1:9999\n", "/usr/sbin/lsof"),
                                     ("", "/bin/ps")]:
            def command(args):
                result = self.command(args)
                if args[0] == command_name:
                    result.stdout = output
                return result
            with patch("status.run", command):
                self.assertFalse(status.listening(123))


if __name__ == "__main__":
    unittest.main()
