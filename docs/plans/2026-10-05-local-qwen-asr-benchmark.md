# Qwen3-ASR standalone model evaluation

The user requested testing local recognition models themselves before deciding
whether to integrate them. This experiment therefore has no Mimi provider,
capture, credentials, translation, WebSocket service or application changes.

Use the original official 0.6B and 1.7B checkpoints, each in its own process, with
the pinned native MLX implementation from `moona3k/mlx-qwen3-asr`. Load BF16
checkpoint tensors as float16, without quantization, alignment, context hints or
speculative decoding. Fix English, greedy temperature zero, MLX seed zero and a
512-token limit per upstream audio chunk. Check every downloaded artifact hash.

Evaluate 24 synthetic English sentences individually, a separate 96-second
concatenation, the familiar JFK excerpt, and 40 public LibriSpeech excerpts with
20 distinct speakers per clean/other split. Keep these groups separate. Report
literal WER and official pinned Whisper EnglishTextNormalizer WER; normalization
changes more than numbers. Add bounded generated silence and a separate paced
audio-feed experiment. Token generation is not proof of real-time audio input.

Offline completion timing starts after the file is decoded to PCM and excludes
model loading. The upstream offline callback exposes complete chunks, not first
tokens. Paced audio feeds 20 ms PCM frames into the upstream 2-second decode /
30-second context API; measure scheduling lag, first text update and EOF flush.
Synchronous decode can block delivery, so an experiment that falls behind must
not claim a real-time capture implementation. The process supervisor provides a
deadline and forceful cancellation boundary; this does not imply in-flight
cooperative GPU cancellation.

Store full public reference/hypothesis results only in explicitly selected
private files outside Git. Commit methodology, hashes, bounded scripts and
aggregate observations. Keep model/cache downloads for reuse. Submit a separate
draft PR and do not merge it. Only the parent coordinator grants the shared
16 GB Mac inference window.
