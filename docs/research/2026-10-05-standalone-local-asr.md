# Standalone local ASR comparison on Apple M5

Date: 2026-10-05. This round tests **speech recognition alone**. No Index,
translation model, cloud ASR, Mimi capture, microphone or development app was
used. These are local file and bounded audio-feed experiments, not a claim that
the candidates are available as finished Mimi service profiles.

## Comparable input and scoring

- Host: Apple M5, 10 CPU cores, 16 GiB unified memory, macOS 26.3.1 (a).
  The reported final runs used only one model process at a time. Downloads/preparation could overlap;
  compiler workloads were deferred until inference completed.
- Human speech: 40 LibriSpeech utterances, 20 from `test-clean` and 20 from
  `test-other`, one utterance per distinct speaker within each split.
  Deterministic SHA ordering was fixed before model output was inspected.
  These are audiobook recordings, not game dialogue with sound effects.
  Total audio: 290.790 s; longest clip: 27.525 s.
- Auxiliary synthetic set: the previous 24 English TTS sentences, 72.263375 s
  of individual files, 239 literal reference words. Its 96.263375 s concatenated
  version includes one-second gaps and is a separate segmentation experiment.
- Audio is 16 kHz mono PCM16. Models receive the same PCM files without reference
  prompts, correction dictionaries or translation. Model artifacts and runtime
  revisions are pinned in the candidate PRs. Inputs and full output remain local.
- **Literal WER** uses lowercase `[a-z0-9]+` tokens. **Normalized WER** uses the
  official Whisper `EnglishTextNormalizer` at
  `86098128c0b4f24f0e2aa2994de830614b474227`, followed by `.split()`.
  This includes number, contraction and spelling normalization; it is not merely
  punctuation removal and is not a semantic accuracy score.
- WER is pooled word edit count divided by pooled reference word count, not the
  average of utterance percentages. Human denominators are 754 literal words and
  752 normalized words (372 clean + 380 other); TTS has 232 normalized words.
  Silent inputs have no reference words, so report insertions instead of WER.

The public corpus is CC BY 4.0, from [OpenSLR 12](https://www.openslr.org/12),
using the pinned [OpenSLR Hugging Face mirror](https://huggingface.co/datasets/openslr/librispeech_asr).
The selection, source SHA verification and WAV conversion are reproducible with
[`prepare_samples.py`](../../tools/local-asr-benchmark/prepare_samples.py).
This small known benchmark is not an unseen real-world holdout and does not
establish quality across accents, music, overlapping speakers or other languages.

## Human English file recognition

| Candidate / runtime | Literal WER | Normalized WER | Clean / other normalized | Decode all 290.79 s | RTF |
| --- | --- | --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 / MLX Metal | 15/754 = 1.99% | 13/752 = 1.73% | 1.61% / 1.84% | 5.28 s | 0.018 |
| Qwen3-ASR 0.6B / MLX Metal | 16/754 = 2.12% | 15/752 = 1.99% | 1.34% / 2.63% | 11.82 s | 0.041 |
| Qwen3-ASR 1.7B / MLX Metal | 13/754 = 1.72% | 9/752 = 1.20% | 0.81% / 1.58% | 29.90 s | 0.103 |
| Fun-ASR-Nano / Transformers CPU, 4 threads | 17/754 = 2.25% | 15/752 = 1.99% | 1.34% / 2.63% | 58.05 s | 0.200 |
| SenseVoiceSmall / FunASR CPU, 4 threads | 45/754 = 5.97% | 36/752 = 4.79% | 2.15% / 7.37% | 20.79 s | 0.071 |

RTF is transcription compute time divided by audio duration; it excludes real-time
playback, endpointing, model loading and rendering. A 0.018 RTF does not mean a
subtitle appears 18 ms after speech. These are measured model/runtime routes on
this Mac: CPU versus Metal results are not an architecture-only speed comparison.
Human clips were decoded in fixed order; OS file caches were not flushed.
Parakeet/Qwen had earlier TTS inputs in the same process; FunASR began the human
set in a fresh loaded worker. Loading/import boundaries differ and are not used
for a startup-speed ranking. An initial Qwen run accidentally overlapped a
second model process; that trial was excluded, a cache-scoped exclusive process
lock was added, and both final offline runs were repeated serially.

The difference between 13 and 15 word edits is small. It is not evidence of a
universal quality ranking. Parakeet is a strong fast English baseline on this
machine; Fun-ASR-Nano is a viable local contender and cannot be dismissed as
unsupported. Qwen3-ASR 1.7B had the fewest normalized word edits on this set; 0.6B
is a faster, smaller alternative. Both ran on Apple Metal through the pinned
community MLX implementation, not CUDA or a cloud API.

## Synthetic and continuous-input limits

| Candidate | 24 complete sentences, literal / normalized | Concatenated 96 s file, literal / normalized | Long-file segmentation |
| --- | --- | --- | --- |
| Parakeet | 10/239 / 0/232 | 23/239 / 10/232 | Fixed nonoverlapping 30 s cuts |
| Qwen3-ASR 0.6B | 5/239 / 2/232 | 3/239 / 2/232 | Runtime default recursive low-energy cuts, at most 30 s |
| Qwen3-ASR 1.7B | 5/239 / 2/232 | 3/239 / 2/232 | Runtime default recursive low-energy cuts, at most 30 s |
| Fun-ASR-Nano | 5/239 / 3/232 | 4/239 / 3/232 | Fixed nonoverlapping 30 s cuts |
| SenseVoiceSmall | 20/239 / 7/232 | 25/239 / 12/232 | Fixed nonoverlapping 30 s cuts |

The 96 s column is **not a strictly identical-segmentation model ranking**.
Parakeet's complete TTS sentences score zero normalized word edits, but the fixed
30 s cuts add real errors, including a duplicated fragment. Nano's time-format
differences in isolated TTS are not equivalent to the actual conflict/repetition
at a long-file cut. Even the official English normalizer does not make every
time/date representation equivalent. No sample-specific post-correction was added.

Both Qwen sizes also received the complete 96 s sample as paced 20 ms PCM
frames, using the upstream 2 s re-decode / 30 s context window. The settings were
fixed endpointing and accuracy finalization, with no VAD gate added:

| Model | Final literal / normalized edits | First text update | EOF flush | Largest feed-call stall |
| --- | --- | --- | --- | --- |
| Qwen 0.6B | 3/239 / 2/232 | 2.355 s | 105.3 ms | 476.8 ms |
| Qwen 1.7B | 0/239 / 0/232 | 2.913 s | 216.6 ms | 1089 ms |

Overall elapsed times were 96.372 s and 96.619 s respectively. The paced harness
waits for the clock and can catch up after synchronous decoding; maximum delivery
lag was 482.6 ms / 1096 ms. This is bounded-window re-decoding, not proof that a
live capture callback can block for that long safely. A future Mimi adapter needs
bounded buffering, cancellation, generation handling and partial/final policy.
The final zero-edit result on one TTS stream is not a zero-error model claim.

File transcription and re-decoding a sliding window do not establish a native
incremental recognizer or a production partial/final contract. This round does
not implement Mimi worker supervision, multi-source capture, reconnects or
subtitle assembly. The earlier Apple/Parakeet/Whisper bridge results in PRs
[#153](https://github.com/yuxino/Mimi/pull/153),
[#156](https://github.com/yuxino/Mimi/pull/156) and
[#157](https://github.com/yuxino/Mimi/pull/157) use different segmentation and
must not be substituted into the file-recognition table.

## Silence, memory and readiness

- Parakeet returned empty output for both 3 s and 10 s digital silence. Each
  FunASR candidate emitted one word on 3 s silence; Qwen 0.6B and 1.7B emitted one and four words respectively on 10 s silence. Those raw-model
  failures are retained. A future service needs VAD/silence handling, tested
  without clipping quiet speech. No silence gate was inserted to improve scores.
- Parakeet's process peak RSS was 0.80 GiB while MLX peak allocations reached
  2.17 GiB. These scopes overlap or omit parts of unified memory and must not be
  added together or described as total model RAM. The candidate reports provide
  their corresponding process and allocator measurements.
- Nano's sampled human-inference worker RSS peaked at about 3.79 GiB, with a
  separate observed load peak up to 4.87 GiB. SenseVoice's human-inference RSS was
  about 1.92 GiB. These are CPU routes; this run did not test their MPS/ONNX/GGUF
  alternatives. It does not prove those alternatives unavailable.
- No simultaneous ASR + translation, 30-minute session, microphone capture,
  other OS, or packaged end-user model install was accepted in this round.
  All model processes exited after testing; downloaded assets are retained.

## Reproduction and delivery

The candidate PRs contain pinned setup tools, bounded standalone runners, their
measured reports and limitations: [Qwen #159](https://github.com/yuxino/Mimi/pull/159) and [FunASR #158](https://github.com/yuxino/Mimi/pull/158). They remain draft and
unmerged. This research update is also unmerged; main is unchanged by these trials.

For the existing Parakeet environment, use
[`parakeet_standalone.py`](../../tools/local-asr-benchmark/parakeet_standalone.py).
It verifies model/sample hashes, limits clips to 120 s, uses a 120 s native-call
deadline, writes private evidence and never downloads during inference.
[`score_asr.py`](../../tools/local-asr-benchmark/score_asr.py) independently
recomputes both score columns from the private evidence with a verified normalizer.
See the [tool README](../../tools/local-asr-benchmark/README.md) for commands.

Corpus manifest SHA-256:
`6d509e4c124efd7a12b1e1f603887ef25b0e21b25f4ae3cc7e47041555ce899e`.
Parakeet private evidence SHA-256:
`d11d5dc9d1909d742a591bd09e724750075a591aad377d1e68121f86c85b5b9c`.
The exact source model is `mlx-community/parakeet-tdt-0.6b-v3` at
`ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15`, `parakeet-mlx==0.5.3`, MLX 0.32.3,
with greedy decoding and a 256 MiB MLX cache limit. No model weights, audio,
full transcripts or credential data are committed.

Tool verification: 13 focused regressions cover exact corpus membership/splits,
failed results, input identity, fixed combined-fixture hashes, independent load/clip
timeouts and cancellation/descendant cleanup. The final tooling hardening did not
change model decoding or rewrite the measured evidence.

The research branch was synchronized with main `a0ac37f`; its application trees
are identical to that revision. Canonical `./scripts/check.sh` passed after the
sync (Rust 1,088 passed / 2 ignored, frontend 1,444 tests, shared-core/JNI, strict
checks and production build). Python tooling checks are separate from hardware
quality evidence. No development or installed app was launched by this round.
