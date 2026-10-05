"""Loopback DashScope-compatible ASR; each WebSocket owns one source."""
import argparse
import asyncio
import base64
from contextlib import suppress
import json
import hmac
import itertools
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import signal
import sys
import time

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed
from segmentation import LANGUAGES, MODEL, Segmenter
from auth import read_token

MAX_QUEUE_BYTES = 64_000
LOG = None


class BridgeError(Exception):
    pass


def diagnostic(event, **fields):
    value = json.dumps({"event": event, **fields}, separators=(",", ":"))
    if LOG is not None:
        LOG.info(value)
    else:
        print(value, flush=True)


def validate_start(raw):
    try:
        message = json.loads(raw)
        header, payload = message["header"], message["payload"]
        task_id = header["task_id"]
        params = payload["parameters"]
        hints = params.get("language_hints", [])
        valid = (isinstance(task_id, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", task_id)
                 and header["action"] == "run-task" and header["streaming"] == "duplex"
                 and payload["task_group"] == "audio" and payload["task"] == "asr"
                 and payload["function"] == "recognition" and payload["model"] == MODEL
                 and params["format"] == "pcm" and params["sample_rate"] == 16_000
                 and isinstance(hints, list) and len(hints) <= 1
                 and all(isinstance(hint, str) and hint in LANGUAGES for hint in hints)
                 and payload.get("input", {}) == {})
        if valid:
            return task_id
    except (ValueError, KeyError, TypeError):
        pass
    raise BridgeError("invalid_setup")


class Worker:
    """One bounded dispatcher keeps a cancelled request from desynchronizing IPC."""
    def __init__(self, model_dir, decode_timeout=15):
        self.model_dir = model_dir
        self.jobs = asyncio.PriorityQueue(maxsize=2)
        self.sequence = itertools.count()
        self.process = None
        self.pump = None
        self.failed = False
        self.decode_timeout = decode_timeout

    async def start(self):
        environment = {**os.environ, "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"}
        self.process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name("worker.py")), str(self.model_dir),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=environment, limit=65_536)
        try:
            value = json.loads(await asyncio.wait_for(self.process.stdout.readline(), 120))
            if value.get("event") != "ready":
                raise BridgeError("model_load_failed")
            diagnostic("model_ready", load_ms=value["load_ms"], peak_rss_bytes=value["peak_rss_bytes"])
            self.pump = asyncio.create_task(self._pump())
        except BaseException:
            await self.close()
            raise

    async def decode(self, pcm, *, final=False):
        if self.failed:
            raise BridgeError("worker_unavailable")
        result = asyncio.get_running_loop().create_future()
        try:
            self.jobs.put_nowait((0 if final else 1, next(self.sequence), pcm, result))
        except asyncio.QueueFull:
            raise BridgeError("inference_queue_full") from None
        return await result

    async def _pump(self):
        while True:
            _, _, pcm, future = await self.jobs.get()
            if future.cancelled():
                pcm, future = b"", None
                continue
            try:
                async with asyncio.timeout(self.decode_timeout):
                    request = json.dumps({"pcm": base64.b64encode(pcm).decode("ascii")}) + "\n"
                    self.process.stdin.write(request.encode())
                    await self.process.stdin.drain()
                    response = json.loads(await self.process.stdout.readline())
                    if response.get("event") != "result" or not isinstance(response.get("text"), str):
                        raise BridgeError("worker_failed")
                    if len(response["text"].encode()) > 16_384:
                        raise BridgeError("output_limit")
                if not future.done():
                    future.set_result(response["text"])
                diagnostic("decode", pcm_bytes=len(pcm), elapsed_ms=response["decode_ms"],
                           peak_rss_bytes=response["peak_rss_bytes"])
            except asyncio.CancelledError:
                if not future.done():
                    future.cancel()
                raise
            except Exception:
                self.failed = True
                if not future.done():
                    future.set_exception(BridgeError("worker_failed"))
                while not self.jobs.empty():
                    _, _, _, pending = self.jobs.get_nowait()
                    if not pending.done():
                        pending.set_exception(BridgeError("worker_failed"))
                if self.process.returncode is None:
                    self.process.kill()
                return
            finally:
                # Idle workers need no reference to a previous source's PCM or
                # final text after the functional response has been delivered.
                pcm, future, request, response = b"", None, None, None

    async def close(self):
        self.failed = True
        if self.pump:
            self.pump.cancel()
            with suppress(asyncio.CancelledError):
                await self.pump
        while not self.jobs.empty():
            _, _, _, pending = self.jobs.get_nowait()
            if not pending.done():
                pending.cancel()
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 2)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()


class Session:
    def __init__(self, websocket, worker, task_id, silence_ms=480):
        self.ws, self.worker, self.task_id = websocket, worker, task_id
        self.queue = asyncio.Queue(maxsize=101)
        self.queued_bytes = 0
        self.silence_ms = silence_ms
        self.segmenter = Segmenter(silence_ms)
        self.last_draft = ""

    async def event(self, name, sentence=None):
        value = {"header": {"event": name, "task_id": self.task_id}}
        if sentence is not None:
            value["payload"] = {"output": {"sentence": sentence}}
        await asyncio.wait_for(self.ws.send(json.dumps(value, ensure_ascii=False)), 2)

    async def read(self):
        async for message in self.ws:
            if isinstance(message, bytes):
                if not message or len(message) > 32768 or len(message) % 2:
                    raise BridgeError("invalid_pcm")
                if self.queued_bytes + len(message) > MAX_QUEUE_BYTES or self.queue.full():
                    raise BridgeError("audio_queue_full")
                self.queued_bytes += len(message)
                self.queue.put_nowait(message)
            else:
                try:
                    value = json.loads(message)
                    valid = (value["header"]["action"] == "finish-task"
                             and value["header"]["task_id"] == self.task_id)
                except (ValueError, KeyError, TypeError):
                    valid = False
                if not valid:
                    raise BridgeError("invalid_event")
                await self.queue.put(None)
                return True
        return False  # socket close is cancellation, not successful EOF

    async def process(self):
        while True:
            pcm = await self.queue.get()
            if pcm is None:
                for segment in self.segmenter.finish():
                    await self.result(segment)
                await self.event("task-finished")
                return
            self.queued_bytes -= len(pcm)
            for segment in self.segmenter.feed(pcm):
                await self.result(segment)

    async def result(self, segment):
        # When newer audio/EOF is already queued, catch up to it instead of
        # paying for an obsolete preview. Finals are never skipped.
        if not segment.begin and not segment.final and not self.queue.empty():
            return
        text = "" if segment.begin else await self.worker.decode(segment.pcm, final=segment.final)
        if not segment.begin:
            if segment.final and not text and self.last_draft:
                raise BridgeError("empty_final")
            if not segment.final and (not text or text == self.last_draft):
                return
            self.last_draft = "" if segment.final else text
        await self.event("result-generated", {
            "text": text, "sentence_id": segment.sentence_id,
            "sentence_begin": segment.begin, "sentence_end": segment.final,
            "begin_time": segment.start_ms, "end_time": segment.end_ms,
            "heartbeat": False,
        })

    async def run(self):
        await self.event("task-started")
        reader = asyncio.create_task(self.read())
        processor = asyncio.create_task(self.process())
        try:
            finished, _ = await asyncio.wait([reader, processor], return_when=asyncio.FIRST_COMPLETED)
            if reader in finished:
                if reader.result():
                    await asyncio.wait_for(processor, 20)
            else:
                await processor
        finally:
            for task in (reader, processor):
                task.cancel()
            await asyncio.gather(reader, processor, return_exceptions=True)
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queued_bytes = 0
            self.segmenter = Segmenter(self.silence_ms)
            self.last_draft = ""


class Bridge:
    def __init__(self, worker, silence_ms=480):
        self.worker = worker
        self.active = 0
        self.silence_ms = silence_ms

    async def handle(self, websocket):
        if self.active >= 2:
            await websocket.close(1013, "session_limit")
            return
        self.active += 1
        task_id = "unassigned"
        started = time.monotonic()
        try:
            raw = await asyncio.wait_for(websocket.recv(), 5)
            if not isinstance(raw, str):
                raise BridgeError("invalid_setup")
            # Even a rejected model/language must echo a valid client task ID.
            with suppress(ValueError, KeyError, TypeError):
                candidate = json.loads(raw)["header"]["task_id"]
                if isinstance(candidate, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", candidate):
                    task_id = candidate
            task_id = validate_start(raw)
            if getattr(self.worker, "failed", False):
                raise BridgeError("worker_unavailable")
            await Session(websocket, self.worker, task_id, self.silence_ms).run()
        except ConnectionClosed:
            pass
        except Exception as error:
            code = str(error) if isinstance(error, BridgeError) else "session_failed"
            with suppress(ConnectionClosed, TimeoutError):
                await asyncio.wait_for(websocket.send(json.dumps({"header": {
                    "event": "task-failed", "task_id": task_id,
                    "error_code": "CLIENT_ERROR", "error_message": code}})), 1)
            diagnostic("session_error", code=code)
        finally:
            self.active -= 1
            diagnostic("session_closed", elapsed_ms=round((time.monotonic() - started) * 1000, 1))


def check_request(token):
    def check(connection, request):
        if request.path != "/v1/asr":
            return connection.respond(404, "not_found\n")
        try:
            authorization = request.headers.get("Authorization", "")
            accepted = hmac.compare_digest(authorization, f"Bearer {token}")
        except (TypeError, ValueError, KeyError):
            accepted = False
        if not accepted:
            return connection.respond(401, "unauthorized\n")
        return None
    return check


async def main(args):
    global LOG
    # RotatingFileHandler creates replacement files too; keep every generation
    # private, not only the initial file created by the controller.
    os.umask(0o077)
    if args.log_file:
        handler = RotatingFileHandler(args.log_file, maxBytes=1_048_576, backupCount=1)
        os.chmod(args.log_file, 0o600)
        LOG = logging.getLogger("parakeet_metadata")
        LOG.setLevel(logging.INFO)
        LOG.addHandler(handler)
        LOG.propagate = False
    # Third-party handshake diagnostics must not include request headers or text.
    logging.getLogger("websockets").disabled = True
    logging.getLogger("websockets.server").disabled = True
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    worker = Worker(args.model_dir)
    token = read_token(args.token_file)
    await worker.start()
    try:
        async with serve(Bridge(worker, args.silence_ms).handle, "127.0.0.1", args.port,
                         origins=[None], process_request=check_request(token),
                         max_size=32768, max_queue=4, write_limit=32768,
                         close_timeout=1, compression=None):
            diagnostic("listening", port=args.port, silence_ms=args.silence_ms)
            await stop.wait()
    finally:
        await worker.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--log-file", type=Path)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--silence-ms", type=int, choices=[240, 320, 480], default=480)
    arguments = parser.parse_args()
    try:
        asyncio.run(main(arguments))
    except Exception:
        diagnostic("fatal", code="service_failed")
        sys.exit(1)
