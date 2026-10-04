# Local Whisper ASR implementation plan

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

Implementation and validation:

- [ ] Pin downloads and hashes; reproducible private installation and manual
  start/status/stop, verifying launchd identity and the exact loopback listener.
- [ ] Bound PCM frames, segments, pending finals and replacement previews;
  silence/maximum-duration/EOF finalization, failure and cancellation handling.
- [ ] Exercise protocol/authentication/bounds/concurrent-session cases with a
  fake worker and real WebSocket transport.
- [ ] Reuse the existing public synthetic English fixture and publish a
  reproducible 24-sentence synthetic corpus generator. Keep WAV/results outside Git.
- [ ] Measure model load, first draft/final, final flush, total time, WER and RSS
  on the same inputs; distinguish direct bridge tests from native Mimi acceptance.
- [ ] Submit a draft PR, without merging. Native dev launch remains coordinated
  by the parent task.

Limits: energy gating is a bounded segmentation heuristic, not a trained VAD.
Drafts are repeated whole-segment decoding, not native incremental Whisper.
An 8-second maximum segment can split continuous words; quality must be measured.
The model is multilingual ASR, but this trial validates English only. Turbo is
not used for speech translation. Translation still follows the selected MT service.
