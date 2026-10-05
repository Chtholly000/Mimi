#!/usr/bin/env python3
"""Local Whisper -> Mimi Custom DashScope ASR. No capture, recording or logs."""
import argparse
import array
import asyncio
from collections import deque
import contextlib
import hmac
from http import HTTPStatus
import json
import logging
import os
from pathlib import Path
import signal
import stat
import struct
import sys

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

MODEL = "whisper-large-v3-turbo-q5_0"
MAX_FRAME = 128 * 1024
MAX_TEXT = 65536
FRAME = 640  # 20 ms, 16 kHz, mono signed little-endian PCM16.
MAX_SEGMENT = 256000  # 8 seconds; includes bounded preroll/trailing silence.
SILENCE_FRAMES = 10  # 200 ms; avoid forcing ordinary short sentence gaps into an 8 s cut.
# Match Mimi's existing Custom DashScope selector; do not claim every Whisper
# language is exposed by the application's current provider catalog.
LANGUAGES = {"en", "zh", "ja", "ko", "auto"}
LOGGER = logging.getLogger("mimi.local.whisper")
LOGGER.addHandler(logging.NullHandler())
LOGGER.propagate = False
LOGGER.disabled = True


class Failure(Exception):
    """Internal static label; never forward arbitrary exception descriptions."""


# Only these source-owned labels may cross the service boundary. Never expose
# arbitrary exception descriptions, recognized text, credentials or paths.
FAILURE_LABELS = frozenset({
    "audio_invalid", "command_invalid", "configuration_invalid", "run_invalid",
    "language_unsupported", "finish_invalid", "finish_timeout", "final_backlog",
    "worker_busy", "worker_failed", "worker_ended", "worker_protocol",
    "worker_result_invalid", "worker_timeout",
    "consumer_ended",
})
PUBLIC_FAILURE_MESSAGES = frozenset("local_asr_" + label for label in FAILURE_LABELS) | {
    "local_asr_failed", "local_asr_timeout",
}


def failure_message(error):
    if isinstance(error, Failure) and str(error) in FAILURE_LABELS:
        return "local_asr_" + str(error)
    if isinstance(error, TimeoutError):
        return "local_asr_timeout"
    return "local_asr_failed"


PUBLIC_FAILURE_CODES = frozenset({
    "SERVER_ERROR", "LOCAL_ASR_OVERLOADED", "LOCAL_ASR_TIMEOUT", "UNSUPPORTED_LANGUAGE",
})


def failure_code(message):
    return {
        "local_asr_final_backlog": "LOCAL_ASR_OVERLOADED",
        "local_asr_worker_busy": "LOCAL_ASR_OVERLOADED",
        "local_asr_worker_timeout": "LOCAL_ASR_TIMEOUT",
        "local_asr_finish_timeout": "LOCAL_ASR_TIMEOUT",
        "local_asr_timeout": "LOCAL_ASR_TIMEOUT",
        "local_asr_language_unsupported": "UNSUPPORTED_LANGUAGE",
    }.get(message, "SERVER_ERROR")


def load_token(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise Failure("token_permissions")
        raw = os.read(fd, 257)
    finally:
        os.close(fd)
    token = raw.decode("ascii").strip()
    if not 32 <= len(token) <= 128 or any(not 33 <= ord(c) <= 126 for c in token):
        raise Failure("token_format")
    return token


def command(raw):
    if not isinstance(raw, str) or len(raw) > 4096:
        raise Failure("command_invalid")
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError):
        raise Failure("command_invalid") from None
    if not isinstance(value, dict) or not isinstance(value.get("header"), dict):
        raise Failure("command_invalid")
    return value


class Segmenter:
    """Keep <=8 s active audio, <=300 ms preroll, and one partial 20 ms frame."""
    def __init__(self):
        self.partial = bytearray()
        self.preroll = deque(maxlen=15)
        self.pcm = bytearray()
        self.silence = 0
        self.next_draft = 64000
        self.sentence = 0

    def push(self, pcm):
        if not pcm or len(pcm) > MAX_FRAME or len(pcm) % 2:
            raise Failure("audio_invalid")
        # Frame input without ever appending a whole message to active audio.
        for offset in range(0, len(pcm), FRAME):
            rest = pcm[offset:offset + FRAME]
            while rest:
                count = min(FRAME - len(self.partial), len(rest))
                self.partial.extend(rest[:count])
                rest = rest[count:]
                if len(self.partial) == FRAME:
                    frame = bytes(self.partial)
                    self.partial.clear()
                    yield from self.frame(frame)

    def frame(self, frame):
        values = array.array("h", frame)
        if sys.byteorder != "little":
            values.byteswap()
        voiced = sum(v * v for v in values) >= len(values) * 256 * 256
        if not self.pcm:
            self.preroll.append(frame)
            if not voiced:
                return
            self.sentence += 1
            self.pcm.extend(b"".join(self.preroll))
            self.preroll.clear()
        else:
            self.pcm.extend(frame)
        self.silence = 0 if voiced else self.silence + 1
        if self.silence >= SILENCE_FRAMES or len(self.pcm) >= MAX_SEGMENT:
            yield self.final()
        elif len(self.pcm) >= self.next_draft:
            self.next_draft += 64000
            yield self.sentence, bytes(self.pcm), False

    def final(self):
        value = self.sentence, bytes(self.pcm), True
        self.pcm.clear()
        self.silence = 0
        self.next_draft = 64000
        return value

    def finish(self):
        if self.partial:
            frame = bytes(self.partial).ljust(FRAME, b"\0")
            self.partial.clear()
            yield from self.frame(frame)
        if self.pcm:
            yield self.final()


class Worker:
    """One model; fair serialized requests. Cancelled callers cannot desync pipes."""
    def __init__(self, executable, model):
        self.executable, self.model = str(executable), str(model)
        self.proc = None
        self.lock = asyncio.Lock()
        self.pending = set()
        self.failed = asyncio.Event()
        self.load_ms = None
        self.monitor = None

    async def start(self):
        self.proc = await asyncio.create_subprocess_exec(
            self.executable, self.model, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            limit=MAX_TEXT * 2 + 512, start_new_session=True)
        async def watch():
            await self.proc.wait()
            self.failed.set()
        self.monitor = asyncio.create_task(watch())
        ready = await asyncio.wait_for(self.read(), 60)
        if ready.get("event") != "ready":
            raise Failure("worker_not_ready")
        self.load_ms = ready.get("load_ms")

    async def read(self):
        line = await self.proc.stdout.readline()
        if not line or len(line) > MAX_TEXT * 2 + 256:
            raise Failure("worker_ended")
        value = json.loads(line)
        if not isinstance(value, dict):
            raise Failure("worker_protocol")
        return value

    async def infer(self, pcm, language, *, is_current=lambda: True):
        if self.failed.is_set() or len(self.pending) >= 4:
            raise Failure("worker_busy")
        task = asyncio.create_task(self.transaction(pcm, language, is_current))
        self.pending.add(task)
        def done(finished):
            self.pending.discard(finished)
            if not finished.cancelled():
                finished.exception()  # Retrieve even when the caller disconnected.
        task.add_done_callback(done)
        return await asyncio.shield(task)

    async def transaction(self, pcm, language, is_current):
        async with self.lock:
            if not is_current():
                return None
            if self.failed.is_set():
                raise Failure("worker_failed")
            try:
                async with asyncio.timeout(15):
                    lang = language.encode("ascii")
                    self.proc.stdin.write(struct.pack("<IB", len(pcm), len(lang)) + lang + pcm)
                    await self.proc.stdin.drain()
                    result = await self.read()
                    text = result.get("text")
                    if (result.get("event") != "result" or not isinstance(text, str)
                            or len(text.encode("utf-8")) > MAX_TEXT):
                        raise Failure("worker_result_invalid")
                    return text.strip()
            except TimeoutError:
                self.failed.set()
                raise Failure("worker_timeout") from None
            except BaseException:
                self.failed.set()
                raise

    async def close(self):
        for task in list(self.pending):
            task.cancel()
        await asyncio.gather(*self.pending, return_exceptions=True)
        if self.proc is not None:
            if self.proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.proc.pid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(self.proc.wait(), 1)
                except asyncio.TimeoutError:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(self.proc.pid, signal.SIGKILL)
                    await self.proc.wait()
            if self.proc.stdin:
                self.proc.stdin.close()
                with contextlib.suppress(Exception):
                    await self.proc.stdin.wait_closed()
        if self.monitor:
            await self.monitor


class Bridge:
    def __init__(self, worker, token):
        self.worker, self.token = worker, token
        self.connections = set()
        self.handling = set()
        self.reservations = set()

    async def release(self, connection):
        await connection.wait_closed()
        if connection not in self.handling:
            self.connections.discard(connection)

    async def authenticate(self, connection, request):
        if request.path != "/asr":
            return connection.respond(HTTPStatus.NOT_FOUND, "not_found\n")
        if request.headers.get_all("Origin"):
            return connection.respond(HTTPStatus.FORBIDDEN, "origin_rejected\n")
        auth = request.headers.get_all("Authorization")
        if len(auth) != 1 or not hmac.compare_digest(
                auth[0].encode("utf-8"), ("Bearer " + self.token).encode("ascii")):
            return connection.respond(HTTPStatus.UNAUTHORIZED, "unauthorized\n")
        if len(self.connections) >= 2 or self.worker.failed.is_set():
            return connection.respond(HTTPStatus.SERVICE_UNAVAILABLE, "busy\n")
        self.connections.add(connection)
        task = asyncio.create_task(self.release(connection))
        self.reservations.add(task)
        task.add_done_callback(self.reservations.discard)
        return None

    async def handler(self, websocket):
        self.handling.add(websocket)
        session = Session(self.worker, websocket)
        try:
            await session.run()
        except (ConnectionClosed, asyncio.CancelledError):
            pass
        except Exception as error:
            if session.task_id is not None:
                with contextlib.suppress(Exception):
                    await session.send("task-failed", error=failure_message(error))
        finally:
            await session.close()
            self.handling.discard(websocket)
            self.connections.discard(websocket)
            with contextlib.suppress(Exception):
                await websocket.close()


class Session:
    def __init__(self, worker, websocket):
        self.worker, self.ws = worker, websocket
        self.task_id = None
        self.language = "auto"
        self.segmenter = Segmenter()
        self.finals = deque()
        self.draft = None
        self.finalized_through = 0
        self.published_draft = None
        self.changed = asyncio.Event()
        self.ended = False
        self.cancelled = False
        self.tasks = []

    async def send(self, event, sentence=None, error=None):
        value = {"header": {"event": event, "task_id": self.task_id}}
        if sentence is not None:
            value["payload"] = {"output": {"sentence": sentence}}
        if error:
            message = error if error in PUBLIC_FAILURE_MESSAGES else "local_asr_failed"
            value["header"].update(error_code=failure_code(message), error_message=message)
        await asyncio.wait_for(self.ws.send(json.dumps(value, ensure_ascii=False)), 1)

    def enqueue(self, value):
        sentence, _, final = value
        if final:
            if len(self.finals) >= 2:
                raise Failure("final_backlog")
            self.finalized_through = sentence
            self.finals.append(value)
            if self.draft and self.draft[0] <= sentence:
                self.draft = None
        else:
            self.draft = value  # Replace, never queue streaming previews.
        self.changed.set()

    async def consume(self):
        while True:
            if self.finals:
                sentence, pcm, final = self.finals.popleft()
            elif self.draft:
                sentence, pcm, final = self.draft
                self.draft = None
            elif self.ended:
                return
            else:
                self.changed.clear()
                await self.changed.wait()
                continue
            text = await self.worker.infer(
                pcm, self.language,
                is_current=lambda: not self.cancelled and (final or sentence > self.finalized_through))
            if text is None:
                continue
            if not text:
                if final and self.published_draft == sentence:
                    # Mimi ignores empty finals. Its existing empty-begin
                    # boundary retracts this preview without confirming it;
                    # the next actual segment reuses this next sentence ID.
                    await self.send("result-generated", {
                        "sentence_id": sentence, "sentence_end": True, "text": ""})
                    await self.send("result-generated", {
                        "sentence_id": sentence + 1, "sentence_begin": True,
                        "sentence_end": False, "text": ""})
                    self.published_draft = None
                continue
            if final or sentence > self.finalized_through:
                await self.send("result-generated", {
                    "sentence_id": sentence, "sentence_end": final, "text": text})
                self.published_draft = None if final else sentence

    async def receive(self):
        async for raw in self.ws:
            if isinstance(raw, bytes):
                for value in self.segmenter.push(raw):
                    self.enqueue(value)
            else:
                header = command(raw)["header"]
                if (header.get("action") != "finish-task" or header.get("task_id") != self.task_id
                        or header.get("streaming") != "duplex"):
                    raise Failure("finish_invalid")
                for value in self.segmenter.finish():
                    self.enqueue(value)
                self.ended = True
                self.changed.set()
                return
        raise Failure("disconnected")

    async def run(self):
        value = command(await asyncio.wait_for(self.ws.recv(), 10))
        header, payload = value["header"], value.get("payload")
        task = header.get("task_id")
        if isinstance(task, str) and 0 < len(task) <= 128 and all(32 <= ord(c) < 127 for c in task):
            self.task_id = task
        if (self.task_id is None or header.get("action") != "run-task"
                or header.get("streaming") != "duplex" or not isinstance(payload, dict)):
            raise Failure("run_invalid")
        params = payload.get("parameters")
        if (payload.get("task_group") != "audio" or payload.get("task") != "asr"
                or payload.get("function") != "recognition" or payload.get("model") != MODEL
                or not isinstance(params, dict) or params.get("format") != "pcm"
                or params.get("sample_rate") != 16000):
            raise Failure("configuration_invalid")
        hints = params.get("language_hints", ["auto"])
        if not isinstance(hints, list) or len(hints) != 1 or hints[0] not in LANGUAGES:
            raise Failure("language_unsupported")
        self.language = hints[0]
        await self.send("task-started")
        receiver = asyncio.create_task(self.receive())
        consumer = asyncio.create_task(self.consume())
        closed = asyncio.create_task(self.ws.wait_closed())
        self.tasks = [receiver, consumer, closed]
        done, _ = await asyncio.wait(self.tasks, return_when=asyncio.FIRST_COMPLETED)
        if closed in done:
            return
        for completed in done:
            completed.result()
        if receiver not in done:
            raise Failure("consumer_ended")
        done, _ = await asyncio.wait([consumer, closed], timeout=45,
                                     return_when=asyncio.FIRST_COMPLETED)
        if closed in done:
            return
        if consumer not in done:
            raise Failure("finish_timeout")
        consumer.result()
        await self.send("task-finished")

    async def close(self):
        self.cancelled = True
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.finals.clear()
        self.draft = None
        self.segmenter = None


async def main(args):
    token = load_token(args.token_file)
    worker = Worker(Path(args.worker).resolve(), Path(args.model).resolve())
    stop = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set)
    waits = []
    startup = []
    try:
        starting = asyncio.create_task(worker.start())
        stopping = asyncio.create_task(stop.wait())
        startup = [starting, stopping]
        completed, _ = await asyncio.wait(startup, return_when=asyncio.FIRST_COMPLETED)
        if stopping in completed:
            return
        starting.result()
        bridge = Bridge(worker, token)
        async with serve(bridge.handler, "127.0.0.1", args.port, process_request=bridge.authenticate,
                         max_size=MAX_FRAME, max_queue=4, write_limit=32768,
                         compression=None, close_timeout=0.25, logger=LOGGER):
            waits = [asyncio.create_task(stop.wait()), asyncio.create_task(worker.failed.wait())]
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
            if worker.failed.is_set() and not stop.is_set():
                raise Failure("worker_failed")
    finally:
        for task in waits + startup:
            task.cancel()
        await asyncio.gather(*waits, *startup, return_exceptions=True)
        await worker.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--port", type=int, default=18082)
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception:
        raise SystemExit("local_whisper_unavailable") from None
