# Qwen3-ASR on Apple Silicon: standalone experiment

This measures recognition models directly. It does not connect to Mimi,
translate text, open a microphone, capture system audio or run a server.
The results below apply to this fixed small English set on one 16 GB M5 Mac.
They are not a multilingual, noisy-room or live-subtitle acceptance claim.

## Reproduce

Run from the repository root on Apple Silicon macOS with `uv` available:

```sh
./tools/local-qwen-asr-benchmark/install.sh
```

This creates a separate Python 3.12 environment under
`~/.local/share/mimi-local-models/qwen-asr`, downloads approximately 6.12 GiB of
official weights, and verifies every runtime/model/normalizer hash. It does not
load either model. Downloads and the environment remain available for reuse.
Apache-2.0 applies to the models and MLX runtime; the Whisper normalizer is MIT.

Supply a local public fixture manifest. JSONL rows contain `id`, `audio_path`
(absolute local path), `reference` (text), `split`, `speaker_id`, `sha256` and
`duration_s`. The runner checks the actual SHA and WAV frame count and accepts
only mono 16 kHz PCM16 WAV, at most 180 seconds per file / 200 cases. It also
accepts the existing `english-24-v1` and `jfk-v1` JSON manifests. Audio and
reference text are deliberately absent from this PR.

```sh
qwen_python="$HOME/.local/share/mimi-local-models/qwen-asr/venv/bin/python"
samples="$HOME/.local/share/mimi-local-models/samples"
"$qwen_python" tools/local-qwen-asr-benchmark/benchmark.py \
  --model 0.6B \
  --manifest "$samples/english-24-v1/manifest.json" \
  --manifest "$samples/librispeech-balanced-v1/manifest.jsonl" \
  --manifest "$samples/jfk-v1/manifest.json" \
  --combined --silence \
  --output "$HOME/.local/share/mimi-local-models/qwen-asr/evidence/offline-06.json"
```

Wait for exit, then use `--model 1.7B` and a new output filename. Results contain
references/hypotheses, so they must be outside Git; atomic checkpoints are 0600.
Terminal progress contains only case IDs, counts and timings. Existing outputs
are rejected. There is no implicit model download at inference time. A local
exclusive process lock rejects a second benchmark, including during model
verification. It does not coordinate unrelated programs using Metal.

For an audio-feed experiment, select a separate JSONL containing the desired
file and add `--mode paced-audio`. Frames are released at a 20 ms cadence to the
upstream `feed_audio` API, with 2-second decode steps and 30-second context.
The synchronous feed call may delay subsequent delivery: inspect maximum lag,
not just total duration. `--deadline` (default 1800 s, maximum 3600 s), Ctrl-C
or SIGTERM stops and reaps the worker, with SIGKILL fallback after 3 s. This is
process cancellation, not cooperative cancellation inside an MLX decode.

## Fixed configuration and measurement boundaries

- Official original Qwen3-ASR 0.6B / 1.7B checkpoints, loaded as float16 without
  quantization. Full revisions and per-file SHA256 are in `assets.json`.
- `moona3k/mlx-qwen3-asr` 0.4.4, commit
  `41878a11cf338c59e13edc84bf4cb35f4b0f3ff6`; MLX/Metal 0.32.3,
  NumPy 2.5.3. Dependencies are pinned with hashes in `requirements.lock`.
- English forced, context empty, greedy temperature 0, MLX random seed 0,
  maximum 512 tokens per chunk, no draft model, diarization or forced aligner.
- Offline long audio uses upstream recursive low-energy splits of at most
  30 seconds, without overlapping samples. This is not the fixed 30-second
  cut used by another model's runner. Only the 64 individual ≤30-second
  utterances are the primary comparison with those other models.
- Literal WER tokenizes with `[a-z0-9]+` after case-folding. The separate
  normalized column uses official `EnglishTextNormalizer(text).split()` at
  Whisper commit `86098128c0b4f24f0e2aa2994de830614b474227`. It changes
  contractions, spelling, fillers and other forms in addition to numbers.
  Micro WER is total edit distance divided by total reference tokens, not
  the mean of per-utterance percentages. Empty-reference WER is undefined;
  silence reports generated word count instead.
- Offline timing starts after PCM loading and excludes model loading. RTF is
  processing seconds / audio seconds. The offline API exposes completed
  chunks, not a first-token callback: `first_token_ms` is null. Audio-feed
  first text is a complete partial hypothesis after a decode step, not token
  streaming. EOF flush is measured after delivering the last PCM frame.
- Process peak RSS and MLX peak allocation are different high-water marks and
  must not be added together. Both are cumulative within that model process;
  they do not measure total system memory or Apple's system ASR service.
- One pass, no confidence intervals. File/model caches are warm after setup;
  shader/tokenizer startup remains visible in each process's first case.

## Evidence

The TTS set has 24 original sentences / 239 literal words, two macOS voices,
72.263375 seconds individually and 96.263375 seconds with gaps. Its combined
WAV SHA256 is `11a7bcc363b22afec54de9bcb26bddc84608d58ba505e44b5ccd6168d3ff5a24`.
The separate human set contains 20 distinct speakers from LibriSpeech
test-clean and 20 from test-other, 290.79 seconds total, with manifest SHA256
`6d509e4c124efd7a12b1e1f603887ef25b0e21b25f4ae3cc7e47041555ce899e`.
The 11-second JFK fixture is familiar public speech, not held-out evidence;
its WAV SHA256 is `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`.

Detailed measurements and exclusions are recorded in `results.md`. Private
evidence stays under the local cache's `evidence/` directory. The first 1.7B
run briefly overlapped an early paced launch and was excluded; both offline
baselines were rerun serially after adding and testing the process lock.

## Checks

```sh
python3 -m unittest discover -s tools/local-qwen-asr-benchmark -p 'test_*.py'
```

These pure tests cover scoring, manifest/audio validation, hash failures,
private output, process exclusion and deadline/reaping. They do not download
weights or substitute for the separate recorded real-model runs.

Primary sources: [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR),
[0.6B model](https://huggingface.co/Qwen/Qwen3-ASR-0.6B),
[1.7B model](https://huggingface.co/Qwen/Qwen3-ASR-1.7B),
[MLX implementation](https://github.com/moona3k/mlx-qwen3-asr/tree/41878a11cf338c59e13edc84bf4cb35f4b0f3ff6),
[Whisper normalizer](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227/whisper/normalizers),
[LibriSpeech](https://www.openslr.org/12).
