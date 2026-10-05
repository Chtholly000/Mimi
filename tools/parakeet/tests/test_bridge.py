import asyncio
from contextlib import asynccontextmanager
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import Bridge, BridgeError, Worker, check_request, validate_start
from auth import ensure_token, read_token
import control
from segmentation import FRAME_BYTES, LANGUAGES, MAX_SEGMENT_BYTES, MODEL, Segmenter
from websockets.asyncio.client import connect as raw_connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed, InvalidStatus

VOICE = struct.pack("<h", 2048) * 320
SILENCE = bytes(FRAME_BYTES)
TEST_TOKEN = "synthetic-test-token-0123456789abcdef"


def connect(url, **kwargs):
    kwargs.setdefault("additional_headers", {"Authorization": f"Bearer {TEST_TOKEN}"})
    return raw_connect(url, **kwargs)


def run_task(task="fixture", language="en"):
    return {"header": {"action": "run-task", "task_id": task, "streaming": "duplex"},
            "payload": {"task_group": "audio", "task": "asr", "function": "recognition",
                        "model": MODEL, "parameters": {"format": "pcm", "sample_rate": 16000,
                        "language_hints": [language]}, "input": {}}}


class SegmentTests(unittest.TestCase):
    def test_forced_boundary_never_replays_or_drops_continuous_pcm(self):
        # Distinct frame contents catch duplicate preroll, even when timestamps
        # look adjacent. This fixture remains model- and recording-free.
        pcm = b"".join(struct.pack("<h", 3000 + frame) * 320 for frame in range(450))
        for chunk_size in (640, 246, 32768):
            with self.subTest(chunk_size=chunk_size):
                segmenter = Segmenter()
                finals = []
                for offset in range(0, len(pcm), chunk_size):
                    finals.extend(value for value in segmenter.feed(pcm[offset:offset + chunk_size]) if value.final)
                finals.extend(value for value in segmenter.finish() if value.final)
                self.assertEqual([(value.start_ms, value.end_ms) for value in finals], [(0, 8000), (8000, 9000)])
                self.assertEqual(b"".join(value.pcm for value in finals), pcm)

    def test_silence_candidate_changes_only_its_explicit_boundary(self):
        short = Segmenter(silence_ms=320)
        standard = Segmenter(silence_ms=480)
        self.assertTrue(any(value.final for value in short.feed(VOICE * 10 + SILENCE * 16)))
        self.assertFalse(any(value.final for value in standard.feed(VOICE * 10 + SILENCE * 16)))
        self.assertTrue(any(value.final for value in standard.feed(SILENCE * 8)))

    def test_stale_pid_file_never_signals_an_unrelated_process(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / "service.json").write_text(json.dumps({"pid": 12345, "port": 8767}))
            class Process:
                stdout = "unrelated-service --port 8767"
            with patch.object(control.subprocess, "run", return_value=Process()), patch.object(control.os, "killpg") as kill:
                control.stop(state)
                kill.assert_not_called()
            self.assertFalse((state / "service.json").exists())

    def test_token_is_private_stable_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / "token"
            ensure_token(token)
            value = read_token(token)
            self.assertEqual(token.stat().st_mode & 0o777, 0o600)
            ensure_token(token)
            self.assertEqual(read_token(token), value)
            alias = Path(directory) / "alias"
            alias.symlink_to(token)
            with self.assertRaises(OSError):
                read_token(alias)

    def test_supported_languages_are_exact_and_no_east_asian_claim(self):
        self.assertEqual(len(LANGUAGES), 25)
        self.assertTrue({"en", "de", "uk"} <= LANGUAGES)
        self.assertFalse({"zh", "ja", "ko"} & LANGUAGES)

    def test_audio_packet_boundaries_do_not_change_segments(self):
        audio = SILENCE * 15 + VOICE * 80 + SILENCE * 24 + VOICE * 5
        def decode(chunk):
            segmenter = Segmenter()
            outputs = []
            for offset in range(0, len(audio), chunk):
                outputs.extend(segmenter.feed(audio[offset:offset + chunk]))
            outputs.extend(segmenter.finish())
            self.assertEqual(segmenter.buffered_bytes, 0)
            return outputs
        self.assertEqual(decode(640), decode(246))
        finals = [value for value in decode(640) if value.final]
        self.assertEqual([value.sentence_id for value in finals], [1, 2])
        self.assertLess(finals[0].start_ms, finals[0].end_ms)

    def test_long_voice_and_silence_have_fixed_memory_bounds(self):
        segmenter = Segmenter()
        maximum, finals = 0, 0
        for frame in [VOICE] * 2000 + [SILENCE] * 2000:
            for value in segmenter.feed(frame):
                self.assertLessEqual(len(value.pcm), MAX_SEGMENT_BYTES)
                finals += value.final
            maximum = max(maximum, segmenter.buffered_bytes)
        self.assertLessEqual(maximum, MAX_SEGMENT_BYTES + 12 * FRAME_BYTES)
        self.assertEqual(finals, 5)
        self.assertEqual(list(segmenter.finish()), [])

    def test_short_tail_is_padded_once_and_empty_eof_does_not_infer(self):
        segmenter = Segmenter()
        self.assertEqual(list(segmenter.finish()), [])
        list(segmenter.feed(VOICE * 4 + VOICE[:100]))
        tail = list(segmenter.finish())
        self.assertEqual(len(tail), 1)
        self.assertTrue(tail[0].final)
        self.assertEqual(len(tail[0].pcm), 5 * FRAME_BYTES)

    def test_rejects_unsupported_hint_model_and_context(self):
        self.assertEqual(validate_start(json.dumps(run_task())), "fixture")
        for field, value in [("model", "other"), ("input", {"context": ["unsupported"]})]:
            request = run_task()
            request["payload"][field] = value
            with self.assertRaises(BridgeError):
                validate_start(json.dumps(request))
        with self.assertRaises(BridgeError):
            validate_start(json.dumps(run_task(language="zh")))


class FakeWorker:
    def __init__(self, delay=0):
        self.calls = []
        self.delay = delay
    async def decode(self, pcm, *, final=False):
        self.calls.append(len(pcm))
        await asyncio.sleep(self.delay)
        return f"fixture {struct.unpack('<h', pcm[:2])[0]}"


class FakeProcess:
    def __init__(self):
        self.stdout = asyncio.StreamReader()
        self.stdin = self
        self.requests = asyncio.Queue()
        self.returncode = None
    def write(self, data):
        self.requests.put_nowait(data)
    async def drain(self):
        pass
    def kill(self):
        self.returncode = -9
    def terminate(self):
        self.returncode = -15
    async def wait(self):
        return self.returncode
    def reply(self, text):
        self.stdout.feed_data((json.dumps({"event": "result", "text": text, "decode_ms": 1,
                                         "peak_rss_bytes": 1000}) + "\n").encode())


@asynccontextmanager
async def endpoint(worker):
    bridge = Bridge(worker)
    async with serve(bridge.handle, "127.0.0.1", 0, origins=[None], process_request=check_request(TEST_TOKEN),
                     max_size=32768, max_queue=4, close_timeout=0.2, compression=None) as server:
        yield f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}/v1/asr", bridge


async def receive(ws):
    return json.loads(await asyncio.wait_for(ws.recv(), 3))


async def finish(ws, task):
    await ws.send(json.dumps({"header": {"action": "finish-task", "task_id": task}, "payload": {"input": {}}}))
    results = []
    while True:
        event = await receive(ws)
        if event["header"]["event"] == "task-finished":
            return results
        results.append(event)


class WebSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_eof_delivers_final_before_finished_and_two_sources_stay_separate(self):
        worker = FakeWorker()
        async with endpoint(worker) as (url, _):
            async with connect(url) as a, connect(url) as b:
                for ws, task in [(a, "system"), (b, "microphone")]:
                    await ws.send(json.dumps(run_task(task)))
                    self.assertEqual((await receive(ws))["header"]["event"], "task-started")
                await a.send(VOICE * 10)
                await b.send(struct.pack("<h", 4096) * 3200)
                first, second = await asyncio.gather(finish(a, "system"), finish(b, "microphone"))
                for events, task, text in [(first, "system", "fixture 2048"), (second, "microphone", "fixture 4096")]:
                    self.assertTrue(all(event["header"]["task_id"] == task for event in events))
                    final = events[-1]["payload"]["output"]["sentence"]
                    self.assertTrue(final["sentence_end"])
                    self.assertEqual(final["text"], text)

    async def test_empty_finish_performs_no_inference(self):
        worker = FakeWorker()
        async with endpoint(worker) as (url, _):
            async with connect(url) as ws:
                await ws.send(json.dumps(run_task()))
                await receive(ws)
                self.assertEqual(await finish(ws, "fixture"), [])
        self.assertEqual(worker.calls, [])

    async def test_browser_origin_and_non_protocol_path_are_rejected(self):
        async with endpoint(FakeWorker()) as (url, _):
            with self.assertRaises(InvalidStatus):
                async with connect(url, origin="https://example.com"):
                    pass
            with self.assertRaises(InvalidStatus):
                async with connect(url + "/other"):
                    pass

    async def test_unauthorized_requests_never_create_a_session(self):
        worker = FakeWorker()
        async with endpoint(worker) as (url, bridge):
            for headers in [{}, {"Authorization": "Bearer wrong"}]:
                with self.assertRaises(InvalidStatus) as error:
                    async with connect(url, additional_headers=headers):
                        pass
                self.assertEqual(error.exception.response.status_code, 401)
            self.assertEqual(bridge.active, 0)
            self.assertEqual(worker.calls, [])

    async def test_cancel_removes_source_and_next_connection_has_fresh_ids(self):
        worker = FakeWorker(delay=0.1)
        async with endpoint(worker) as (url, bridge):
            async with connect(url) as ws:
                await ws.send(json.dumps(run_task("cancelled")))
                await receive(ws)
                await ws.send(VOICE * 40)
                await receive(ws)  # sentence begin, decode is pending
            await asyncio.sleep(0.15)
            self.assertEqual(bridge.active, 0)
            async with connect(url) as ws:
                await ws.send(json.dumps(run_task("next")))
                await receive(ws)
                await ws.send(VOICE * 5)
                events = await finish(ws, "next")
                self.assertTrue(all(event["header"]["task_id"] == "next" for event in events))
                self.assertEqual(events[-1]["payload"]["output"]["sentence"]["sentence_id"], 1)

    async def test_full_pcm_queue_reports_failure_instead_of_dropping_audio(self):
        async with endpoint(FakeWorker(delay=0.2)) as (url, _):
            async with connect(url) as ws:
                await ws.send(json.dumps(run_task()))
                await receive(ws)
                for _ in range(5):
                    await ws.send(VOICE * 50)
                while True:
                    value = await receive(ws)
                    if value["header"]["event"] == "task-failed":
                        self.assertEqual(value["header"]["error_message"], "audio_queue_full")
                        break

    async def test_third_source_is_rejected(self):
        async with endpoint(FakeWorker()) as (url, _):
            async with connect(url) as a, connect(url) as b:
                for ws in (a, b):
                    await ws.send(json.dumps(run_task()))
                    await receive(ws)
                async with connect(url) as third:
                    with self.assertRaises(ConnectionClosed):
                        await third.recv()

    async def test_cancelled_worker_job_does_not_accept_next_response(self):
        # Exercise dispatcher cancellation without loading MLX or a subprocess.
        worker = Worker(Path("unused"))
        request = asyncio.create_task(worker.decode(b"fixture"))
        await asyncio.sleep(0)
        request.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request
        _, _, _, future = worker.jobs.get_nowait()
        self.assertTrue(future.cancelled())
        await worker.close()

    async def test_cancellation_during_ipc_consumes_old_reply_before_new_request(self):
        worker = Worker(Path("unused"))
        process = worker.process = FakeProcess()
        worker.pump = asyncio.create_task(worker._pump())
        first = asyncio.create_task(worker.decode(b"first"))
        await process.requests.get()
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        second = asyncio.create_task(worker.decode(b"second"))
        process.reply("old source")
        await process.requests.get()
        process.reply("new source")
        self.assertEqual(await second, "new source")
        await worker.close()

    async def test_stalled_worker_fails_pending_and_future_jobs(self):
        worker = Worker(Path("unused"), decode_timeout=0.02)
        process = worker.process = FakeProcess()
        worker.pump = asyncio.create_task(worker._pump())
        first = asyncio.create_task(worker.decode(b"first"))
        await process.requests.get()
        second = asyncio.create_task(worker.decode(b"second"))
        for pending in (first, second):
            with self.assertRaises(BridgeError):
                await pending
        self.assertEqual(process.returncode, -9)
        with self.assertRaises(BridgeError):
            await worker.decode(b"third")
        await worker.close()

    async def test_queued_final_precedes_other_source_preview(self):
        worker = Worker(Path("unused"))
        draft = asyncio.create_task(worker.decode(b"draft"))
        final = asyncio.create_task(worker.decode(b"final", final=True))
        await asyncio.sleep(0)
        first = worker.jobs.get_nowait()
        second = worker.jobs.get_nowait()
        self.assertEqual(first[2], b"final")
        self.assertEqual(second[2], b"draft")
        first[3].set_result("final")
        second[3].set_result("draft")
        await asyncio.gather(draft, final)
        await worker.close()

    async def test_rejected_language_echoes_the_requested_task(self):
        async with endpoint(FakeWorker()) as (url, _):
            async with connect(url) as ws:
                await ws.send(json.dumps(run_task("language-test", "ja")))
                event = await receive(ws)
                self.assertEqual(event["header"]["task_id"], "language-test")
                self.assertEqual(event["header"]["event"], "task-failed")

    async def test_connection_check_does_not_pass_after_worker_failure(self):
        worker = FakeWorker()
        worker.failed = True
        async with endpoint(worker) as (url, _):
            async with connect(url) as ws:
                await ws.send(json.dumps(run_task()))
                event = await receive(ws)
                self.assertEqual(event["header"]["event"], "task-failed")
                self.assertEqual(event["header"]["error_message"], "worker_unavailable")


if __name__ == "__main__":
    unittest.main()
