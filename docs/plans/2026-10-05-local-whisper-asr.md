# Local Whisper ASR design

Goal: offer an explicitly installed, local macOS Apple Silicon ASR service for
Mimi's existing Custom DashScope recognition profile, with independent text
translation. No new desktop or Android provider and no audio capture in the service.

Architecture: pinned whisper.cpp v1.9.4 and large-v3-turbo Q5_0, a small native
stdin/stdout worker, and an authenticated Python WebSocket adapter on
127.0.0.1:18082. One model is loaded before listening. At most two independently
segmented sessions share FIFO serialized inference, allowing system/microphone
source isolation without loading two models. No transcript, PCM or token logs.

Tech stack: C++17, whisper.cpp Metal, Python 3.12, websockets 15.0.1; launchd is
loaded explicitly and is not installed as a login agent.

Lifecycle and bounds: private, hash-verified installation preserves build/model
caches and does not load the model. Explicit start/status/stop verify the launchd
job, bridge command, worker child and exact loopback listener. The bridge accepts
only bearer-authenticated, non-browser connections; it never reads microphone or
system audio itself. Each connection owns <=8 s active PCM, <=300 ms preroll,
two pending finals and one replaceable preview. A 20 ms energy gate closes after
200 ms quiet; previews decode at 2 s intervals. Finalization retires queued drafts
before they acquire the shared worker. In-flight decoding is bounded by 15 s but
is not immediately cancellable; disconnects suppress delivery and preserve the
shared framing until the worker response is drained.

Validation uses fake workers, real loopback WebSockets and pinned public fixtures,
without capture. The 24-sentence generator is original CC0 text; audio, raw result
content and credentials remain outside Git. The final tested worker uses 1024
encoder positions; the 512 candidate was rejected after a repetition regression.
See [measurements](../../tools/local-whisper/measurements.md) for exact revisions,
hashes, the 600/200 ms comparison, simultaneous EOF and remaining native boundaries.

Limits: energy gating is a bounded segmentation heuristic, not a trained VAD.
Drafts are repeated whole-segment decoding, not native incremental Whisper.
An 8-second maximum segment can split continuous words; quality must be measured.
The model is multilingual ASR, but this trial validates English only. Turbo is
not used for speech translation. Translation still follows the selected MT service.
