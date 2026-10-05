# FunASR on Apple Silicon: ASR-only English results

2026-10-05. SenseVoiceSmall and Fun-ASR-Nano both ran successfully on this Mac's
CPU. Nano made fewer word errors on this fixed English sample set; SenseVoice
used less memory and completed it faster. Neither result establishes live
subtitle latency, and both emitted a word on the digital-silence control.

No Mimi session, capture, translation or cloud inference was involved. The
development and installed applications were untouched.

## Reproduction and scope

- Host: Apple M5, 16 GiB, macOS 26.3.1(a), build `25D771280a`.
- Python 3.12.13; Torch/Torchaudio 2.10.0; FunASR 1.4.16; Transformers 5.17.0;
  CPU FP32, four Torch threads, one model process at a time.
- [Tools and commands](../../tools/funasr/README.md),
  [dependency lock](../../tools/funasr/requirements-macos-arm64.lock),
  [model revisions/file SHA256](../../tools/funasr/models.json),
  [normalizer revision/file SHA256](../../tools/funasr/normalizer.json),
  [design](../plans/2026-10-05-funasr-benchmark-design.md).
- Base application revision `a0ac37f`, with the task's uncommitted benchmark
  tools during measurement. Subsequent edits added metadata clarifications,
  scoring/completeness checks, cancellation cleanup and documentation; inference parameters were unchanged.
- Install resolved successfully. The shared normalizer initially lacked
  `more-itertools`; pinning `11.1.0` completed scoring. This was a scorer dependency,
  not a model-installation or inference failure.

| Model | Pinned official repository revision | Required downloaded files | Main weight SHA256 |
| --- | --- | ---: | --- |
| SenseVoiceSmall | `3847d57b6bdf2dd8875cb1508d2af43d80a16bf7` | 936,682,164 bytes | `833ca2dcfdf8ec91bd4f31cfac36d6124e0c459074d5e909aec9cabe6204a3ea` |
| Fun-ASR-Nano-2512-hf | `7ef6cafdc445b5beff0b730cbeb51952c793ca6e` | 1,675,650,310 bytes | `1bbb6dcc5d8b75084a399d48c4d4b0f3aa1d3f09f2616ae40ed2c4fba03d89c9` |

The [SenseVoiceSmall card](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)
lists Mandarin/Cantonese/English/Japanese/Korean and links a custom model license.
The [Nano card](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512-hf)
is Apache-2.0 and covers Chinese/English/Japanese; the separate MLT checkpoint's
31-language coverage does not transfer to this model. The
[official Transformers guide](https://github.com/modelscope/FunASR/blob/main/docs/transformers_native.md)
provides the native CPU API used here. It does not supply streaming state or a
serving protocol.

## Fixed inputs and scoring

TTS24 consists of 24 original CC0 English sentences, macOS Samantha/Daniel voices,
160/190 wpm, 72.263 seconds total individually. The combined file is 96.263 seconds
including one-second gaps, SHA256
`11a7bcc363b22afec54de9bcb26bddc84608d58ba505e44b5ccd6168d3ff5a24`.

The human set contains 20 test-clean plus 20 test-other LibriSpeech clips,
290.790 seconds total, 40 speakers. Fixed dataset revision
`71cacbfb7e2354c4226d01e70d77d5fca3d04ba1`, selection seed
`mimi-librispeech-asr-v1`, manifest SHA256
`6d509e4c124efd7a12b1e1f603887ef25b0e21b25f4ae3cc7e47041555ce899e`.
See [OpenSLR LibriSpeech and CC BY 4.0](https://www.openslr.org/12), the
[fixed dataset files](https://huggingface.co/datasets/openslr/librispeech_asr/tree/71cacbfb7e2354c4226d01e70d77d5fca3d04ba1),
and [shared sample preparation in PR #55](https://github.com/yuxino/Mimi/pull/55).
These short audiobook samples are not a broad test of dialogue, overlap, music,
games or arbitrary accents, and a standard public benchmark is not known to be
held out from model training.

JFK is the familiar 11-second
[whisper.cpp sample](https://github.com/ggml-org/whisper.cpp/blob/927cfce34f31707e17f2bff35c349632fb9e2c3a/samples/jfk.wav),
SHA256 `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`.
The negative control is exactly three seconds of generated zero PCM.

All inputs are 16 kHz mono PCM16. Ordinary clips are decoded independently, with
no VAD, hotwords or previous transcript. SenseVoice uses English and `use_itn=True`;
Nano uses the official English transcription template, no explicit ITN override,
greedy generation, at most 512 new tokens. Every Nano call reached EOS.
The first evidence metadata encoded Nano's absent ITN override as `false`; an
appended metadata correction records `null`/checkpoint default. Hypotheses and
measurements are unchanged.

Literal WER uses `[a-z0-9]+` after case folding. The other column uses official
Whisper `EnglishTextNormalizer` at
[`86098128c0b4f24f0e2aa2994de830614b474227`](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227/whisper/normalizers),
then whitespace tokenization. Its number, contraction, spelling and punctuation
rules can change reference word counts; it is not a semantic-equivalence oracle.

## Accuracy

| Input | SenseVoice literal errors/words | SenseVoice normalized | Nano literal errors/words | Nano normalized |
| --- | ---: | ---: | ---: | ---: |
| TTS24, individual clips | 20/239 (8.37%) | 7/232 (3.02%) | 5/239 (2.09%) | 3/232 (1.29%) |
| Human test-clean, 20 clips | 13/374 (3.48%) | 8/372 (2.15%) | 7/374 (1.87%) | 5/372 (1.34%) |
| Human test-other, 20 clips | 32/380 (8.42%) | 28/380 (7.37%) | 10/380 (2.63%) | 10/380 (2.63%) |
| Human combined, 40 clips | 45/754 (5.97%) | 36/752 (4.79%) | 17/754 (2.25%) | 15/752 (1.99%) |
| JFK, one clip | 0/22 | 0/22 | 0/22 | 0/22 |
| TTS combined, fixed 30-second slices | 25/239 (10.46%) | 12/232 (5.17%) | 4/239 (1.67%) | 3/232 (1.29%) |
| Three-second digital silence | 1 inserted word | reported separately | 1 inserted word | reported separately |

Nano's three normalized TTS24 differences all concern the time/date notation in
case `en-08`; inspection found equivalent written forms rather than a changed
time. SenseVoice also has actual spelling, proper-name repetition and preposition
errors among its TTS differences. Raw transcripts stay in the private evidence.

The continuous case is decoded in four **offline** blocks: `[0,30)`, `[30,60)`,
`[60,90)`, `[90,96.263375)` seconds, with no overlap or text repair. This is a
segmentation stress test, not native streaming. Nano's first cut damaged a time
expression; SenseVoice had additional cut-adjacent losses. Equal aggregate counts
between Nano's individual and combined runs do not mean the same errors. Improving
segmentation requires its own fixed-input comparison; these errors were retained.

## CPU time and memory

RTF is inference-call wall time / audio duration, excluding model load. It includes
feature extraction and output delivery to the parent. The model receives each
whole clip/block immediately, so these timings must not be called live subtitle
latency or time to first draft.

| Input | SenseVoice wall time / RTF | Nano wall time / RTF |
| --- | ---: | ---: |
| TTS24 individual, 72.263 s audio | 11.411 s / 0.158 | 24.921 s / 0.345 |
| Human40, 290.790 s audio | 20.793 s / 0.0715 | 58.057 s / 0.200 |
| JFK, 11 s audio | 0.587 s / 0.0534 | 2.095 s / 0.190 |
| TTS combined, 96.263 s audio | 2.947 s / 0.0306 | 15.612 s / 0.162 |

| Measurement | SenseVoice | Nano |
| --- | ---: | ---: |
| First observed model/process load | 33.372 s | 2.984 s |
| Subsequent fresh-process loads, cached environment/files | 2.812–3.888 s | 2.166–2.858 s |
| TTS24 first clip | 0.479 s | 1.463 s |
| TTS24 subsequent median | 0.474 s | 1.006 s |
| Human40 first clip, 27.525 s audio | 0.733 s | 4.293 s |
| Human40 subsequent median | 0.511 s | 1.263 s |
| Highest sampled load RSS across runs | 3,151 MiB | 4,986 MiB |
| Highest sampled decode RSS across runs | 1,966 MiB | 3,981 MiB |

RSS is sampled from the worker every 50 ms, in bytes before conversion to MiB.
It is not process `ru_maxrss` or whole-system/Metal memory. Timing is one observed
run per case; no caches were cleared and no formal hardware-cold comparison was
performed. The initial SenseVoice load is therefore reported, not treated as a
stable startup estimate. All inference workers exited after their runs.

## Delivery boundaries

- CPU inference and the above English samples are verified. MPS, ONNX, GGUF,
  Windows/Linux and other model languages were not tested.
- `paraformer-zh-streaming` and sherpa's explicit bilingual streaming Paraformer
  are separate candidates. They were not needed to answer whether these two
  offline models work on this Mac; no Paraformer accuracy claim is made.
- Zero-input hallucinations are retained. No VAD or text filter was added after
  the result to report a clean negative control.
- No subtitle preview/final protocol, microphone/system separation, capture,
  Index/MT, native overlay or packaging acceptance is claimed by this experiment.
- All 15 focused tool tests passed, covering manifests/hashes/scoring/chunk
  boundaries, incomplete-run rejection, EOF/timeout/SIGTERM and descendant
  cleanup. Canonical `scripts/check.sh` passed: desktop Rust 1,088 passed /
  2 ignored, frontend 110 files / 1,444 tests, shared core/JNI, strict checks
  and production build. CI status is tracked on the draft PR.
- Private evidence is under the model storage root's `evidence/`, in
  `{sensevoice,nano}-cpu-{tts24,human40,supplemental,combined}-v1.jsonl`.
  `summary-v2.jsonl` contains counts/timings only. Audio, references, hypotheses,
  model binaries, venvs and host-specific absolute paths are excluded from Git.
