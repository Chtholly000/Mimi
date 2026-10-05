# Local FunASR model benchmark

Standalone ASR experiments for Apple Silicon macOS. This tool loads official
SenseVoiceSmall or Fun-ASR-Nano weights and transcribes local English WAV files.
It does not connect Mimi, Index Translate, a cloud service, microphone, system
capture or a listening server.

The [measured report](../../docs/research/2026-10-05-funasr-macos.md) contains
accuracy, CPU timing, resource measurements and the remaining limitations.

## Install explicitly

Python 3.12.13 and `uv` are required. The setup command can download that Python
version, installs the recorded macOS ARM64 dependency lock into an isolated venv,
and downloads about 2.61 GB of model/configuration files plus the pinned official
Whisper English normalizer. It does not load or run a model.

```sh
bash tools/funasr/setup.sh
```

The default storage root is `~/.local/share/mimi-local-models/funasr`; an optional
first argument selects another dedicated root. Do not point it at an unrelated
venv: setup synchronizes its packages to the lock. `models.json` fixes repository
revisions and every required file's SHA256. Downloads also check Hugging Face LFS
hashes. Normal recognition uses only verified local files with hub/update checks
disabled; no remote checkpoint Python is trusted.

| Model | Tested runtime | Model language coverage | Weight license |
| --- | --- | --- | --- |
| SenseVoiceSmall, 234M | FunASR 1.4.16 / PyTorch CPU FP32 | Mandarin, Cantonese, English, Japanese, Korean | [Custom FunASR model license](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE) |
| Fun-ASR-Nano-2512-hf, about 800M | Transformers 5.17.0 / PyTorch CPU FP32 | Chinese, English, Japanese; Chinese dialects/accents | [Apache-2.0 model card](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512-hf) |

Base Nano is distinct from the 31-language MLT-Nano checkpoint. These tests use
file recognition. Neither this runner nor adding fixed chunks proves native
streaming support. MPS is an explicit experimental option; it has **not** been
validated here and silent CPU fallback is rejected.

## Inputs and reproducible runs

Use 16 kHz, mono, signed PCM16 WAV files. A JSONL manifest has one record per clip:
`id`, `audio_path` (local path), `reference` (text), `sha256`, and optional `split`,
`speaker_id`, `duration_s`. Audio SHA256 is required and checked before loading.
Clips must be nonempty and at most 30 seconds. Empty *reference text* is allowed
for a deliberate silence test.

The shared [public sample preparation tool in PR #55](https://github.com/yuxino/Mimi/pull/55)
uses `tools/local-asr-benchmark/prepare_samples.py` and produces the 40-clip
LibriSpeech manifest used in the report. Its README records the fixed dataset
revision, selection method and license. Keep downloaded audio, references and
result JSONL outside Git.

```sh
model_root="$HOME/.local/share/mimi-local-models/funasr"
python="$model_root/venv/bin/python"
manifest="$HOME/.local/share/mimi-local-models/samples/librispeech-balanced-v1/manifest.jsonl"
"$python" tools/funasr/benchmark.py --model sensevoice --manifest "$manifest" \
  --output "$model_root/evidence/sensevoice-human40.jsonl"
"$python" tools/funasr/benchmark.py --model nano --manifest "$manifest" \
  --output "$model_root/evidence/nano-human40.jsonl"
"$python" tools/funasr/summarize.py "$model_root/evidence/sensevoice-human40.jsonl" \
  "$model_root/evidence/nano-human40.jsonl"
```

Run one model at a time. Each command starts one owned process, fixes Torch to four
CPU threads and reuses the loaded model across that manifest. Load time, first
clip and later clips are separate; there is no hidden warmup. Loading has a
180-second deadline; each inference call defaults to 120 seconds. Failure or
cancellation closes and, if needed, terminates/kills only that worker's process
group. Results are flushed per clip. SIGTERM/keyboard cancellation runs the same bounded
cleanup, including descendants after their leader exits. Reusing an output filename fails rather than
overwriting evidence.

The historical TTS24 JSON format is also accepted: `cases` contain `id`, `wav`,
`reference` (file), `sha256` and optional `reference_sha256`. With `--combined`,
its `combined` record is read and divided into contiguous, nonoverlapping 30-second
blocks, each decoded with fresh state. Their text is concatenated only to score
coverage. There is no VAD, overlap, boundary repair, real-time pacing or time to
first draft measurement. Hard cuts can split words; the report retains those
errors.

SenseVoice is explicitly called with `language="en", use_itn=True`. Nano uses the
checkpoint's official transcription template with `language="en"`, no keywords,
no added context and no ITN override. Nano generation is greedy, bounded at 512
new tokens and checked for EOS. An EOS/returned CTC result does not prove full
recognition coverage; the `complete` field refers only to successful termination.

CLI progress contains only IDs, counts and timings. Private 0600 JSONL contains
reference/hypothesis text, input/model hashes, process metrics and sanitized
status; full diagnostic error detail, when present, also stays in that file.
Library stdout/stderr are suppressed. Output paths inside this checkout are
rejected. Model/sample validation and file hashing occur before the measured load.

## Scoring and tests

The summary checks expected case IDs/count/order and rejects aborted, failed or
incomplete runs before showing per-clip and aggregate results. Literal WER tokenizes with
`re.findall(r"[a-z0-9]+", text.casefold())`. Normalized WER uses the SHA-verified
OpenAI Whisper `EnglishTextNormalizer` at revision
`86098128c0b4f24f0e2aa2994de830614b474227`, followed by `.split()`. This includes
number, spelling, contraction and other normalization; it is not a semantic
accuracy score. Silence insertions are listed separately from speech WER.

RSS is the owned worker's resident memory sampled every 50 ms, reported in bytes.
It is not `ru_maxrss`, whole-system memory or the total Metal/unified-memory cost.
RTF is inference-call wall time divided by audio duration, excluding load time.
For these offline models, RTF is throughput, **not live subtitle delay**.

```sh
model_root="$HOME/.local/share/mimi-local-models/funasr"
"$model_root/venv/bin/python" -B -m unittest discover -s tools/funasr -p 'test_*.py'
```

The focused tests use generated temporary PCM and fake child processes. CI runs
them without downloading model weights or loading Torch. For the macOS dependency
lock, Windows/Linux installation and performance remain unverified.
