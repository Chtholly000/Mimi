"""Bounded PCM segmentation; no model, networking, files, or transcript history."""
from array import array
from collections import deque
from dataclasses import dataclass
import sys

RATE = 16_000
FRAME_BYTES = 640
MAX_SEGMENT_BYTES = RATE * 2 * 8
DRAFT_BYTES = RATE * 2 * 800 // 1000
LANGUAGES = frozenset("bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk".split())
MODEL = "parakeet-tdt-0.6b-v3"


@dataclass(frozen=True)
class Segment:
    sentence_id: int
    pcm: bytes
    start_ms: int
    end_ms: int
    final: bool
    begin: bool = False


class Segmenter:
    def __init__(self, silence_ms=480):
        if silence_ms not in (240, 320, 480):
            raise ValueError("invalid_silence_boundary")
        self.silence_frames = silence_ms // 20
        self.partial = bytearray()
        self.preroll = deque(maxlen=12)
        self.audio = bytearray()
        self.samples = 0
        self.start_sample = 0
        self.sentence_id = 0
        self.silent_frames = 0
        self.onset_frames = 0
        self.next_draft = DRAFT_BYTES

    @property
    def buffered_bytes(self):
        return len(self.partial) + len(self.audio) + sum(map(len, self.preroll))

    def _snapshot(self, final=False, begin=False):
        return Segment(self.sentence_id, b"" if begin else bytes(self.audio),
                       self.start_sample * 1000 // RATE, self.samples * 1000 // RATE,
                       final, begin)

    def feed(self, pcm):
        if not pcm or len(pcm) > 32768 or len(pcm) % 2:
            raise ValueError("invalid_pcm")
        self.partial.extend(pcm)
        while len(self.partial) >= FRAME_BYTES:
            frame = bytes(self.partial[:FRAME_BYTES])
            del self.partial[:FRAME_BYTES]
            self.samples += FRAME_BYTES // 2
            values = array("h", frame)
            if sys.byteorder != "little":
                values.byteswap()
            voiced = sum(value * value for value in values) >= len(values) * 256 * 256
            if not self.audio:
                self.preroll.append(frame)
                self.onset_frames = self.onset_frames + 1 if voiced else 0
                if self.onset_frames < 3:
                    continue
                self.audio.extend(b"".join(self.preroll))
                self.preroll.clear()
                self.sentence_id += 1
                self.start_sample = self.samples - len(self.audio) // 2
                yield self._snapshot(begin=True)
            else:
                self.audio.extend(frame)
            self.silent_frames = 0 if voiced else self.silent_frames + 1
            if self.silent_frames >= self.silence_frames or len(self.audio) >= MAX_SEGMENT_BYTES:
                yield self._snapshot(final=True)
                self._reset_segment()
            elif len(self.audio) >= self.next_draft:
                yield self._snapshot()
                self.next_draft += DRAFT_BYTES

    def _reset_segment(self):
        self.audio.clear()
        self.silent_frames = 0
        self.onset_frames = 0
        self.next_draft = DRAFT_BYTES

    def finish(self):
        if self.partial:
            # At most 19.94 ms of zero padding preserves the final partial frame.
            padding = bytes(FRAME_BYTES - len(self.partial))
            yield from self.feed(padding)
        if self.audio:
            yield self._snapshot(final=True)
        self._reset_segment()
        self.preroll.clear()
        self.partial.clear()
