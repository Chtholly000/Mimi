# Local Parakeet ASR for Mimi

An optional Apple Silicon bridge for **NVIDIA Parakeet TDT 0.6B v3**, using
the third-party [parakeet-mlx](https://github.com/senstella/parakeet-mlx)
implementation. It converts selected audio into original-language text; Mimi's
independent text translator can then translate that text. There is no audio
capture in this service. It is not included in the normal Mimi app bundle.

## Setup and lifecycle

Requires **macOS 26 or later on Apple Silicon**, Python 3.12 (managed by `uv` if necessary), and
[uv](https://docs.astral.sh/uv/getting-started/installation/). The pinned MLX
runtime is 0.32.3, whose Metal wheel targets macOS 26; this lock does not claim
support for older macOS versions. Run from the repository root:

```sh
python3 tools/parakeet/control.py setup
python3 tools/parakeet/control.py start
python3 tools/parakeet/control.py status
python3 tools/parakeet/control.py stop
```

`setup` explicitly downloads dependencies and the fixed model revision.
The weight file is approximately 2.51 GB, plus the Python environment.
`start` loads local weights and warms the model before accepting connections;
it does not download missing assets. `stop` checks the process identity, requests
shutdown and kills only this service's process group if its deadline expires.
Keep this checkout until the service is stopped. Nothing starts automatically at
login, and none of these commands changes Mimi's preferences, credentials or
proxy settings. A failed start is reported rather than silently using a cloud
recognizer. Use `--port` to select a different loopback port.

Weights, the virtual environment, bounded metadata logs and process state live
under `~/.local/share/mimi-local-models/parakeet`; `--state-dir` overrides that
directory. No model files or private media belong in this repository. Metadata
logs contain timings, counts and sanitized status labels only, with a 1 MiB
limit and one rotated backup. Downloaded weights remain after stop for reuse.

## Mimi configuration

Add **自定义识别（阿里云兼容）** (Custom ASR, DashScope-compatible):

| Field | Value |
| --- | --- |
| Endpoint | `ws://127.0.0.1:8767/v1/asr` |
| Model | `parakeet-tdt-0.6b-v3` |
| API key | The generated token in `~/.local/share/mimi-local-models/parakeet/bridge-token` |
| Source | A supported language, or Automatic within the supported set |
| Text translation | Original, or an independently configured translator |

Setup generates a random local token once in a mode-0600 file; subsequent setup
runs preserve it. Copy that file's contents into Mimi's API key field. Commands,
logs and environment variables never print or carry its value. The service
checks Bearer authentication before creating a session, binds only IPv4 loopback
and rejects browser Origin requests. Do not expose the port using forwarding
or a proxy. Each WebSocket owns its
audio and sentence state. At most two simultaneous connections support Mimi's
independent system and microphone lanes. The shared model serializes inference;
queue pressure is reported as failure rather than dropping audio silently.

The model detects its language automatically. The selected source is validated
against its supported set, but is not a forced-decoding language instruction.
Context prompts are unsupported and rejected.

## Languages and limits

The [NVIDIA model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
lists these 25 languages: Bulgarian, Croatian, Czech, Danish, Dutch, English,
Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian,
Lithuanian, Maltese, Polish, Portuguese, Romanian, Slovak, Slovenian, Spanish,
Swedish, Russian and Ukrainian. **Chinese, Japanese and Korean are not supported.**

This is short-segment recognition with replaceable previews. A simple energy
gate retains 240 ms of preroll, finalizes after 480 ms of silence, and caps a
segment at eight seconds. It re-decodes the current segment every 800 ms.
To compare a shorter endpoint explicitly, stop and restart with
`python3 tools/parakeet/control.py start --silence-ms 320` (240 is also accepted).
The default remains 480 ms: shorter gaps can finalize earlier, but can also split
an English phrase at a natural pause. A tested 320 ms candidate did not improve
the short sample's eight-second forced boundary.
Quiet speech can be missed; noise/music can open the gate; a forced boundary
can split a word. These are quality tradeoffs, not native streaming guarantees.
The upstream streaming implementation is intentionally not used unchanged: its
default right context delays commitment by about 20.48 seconds and retains an
ever-growing list of finalized tokens.

Each source has a 64,000-byte PCM queue, plus bounded WebSocket buffers and one
eight-second segment. Drafts replace the full current sentence; final sentences
are not retained by the bridge. EOF drains queued audio before the final and
task-finished events. Closing a socket cancels it; an already running inference
may finish internally, but its result cannot reach another source. A stalled
worker fails requests and must be restarted explicitly.

## Reproducible checks

```sh
~/.local/share/mimi-local-models/parakeet/venv/bin/python -B -m unittest discover -s tools/parakeet/tests -v
~/.local/share/mimi-local-models/parakeet/venv/bin/python tools/parakeet/benchmark.py \
  /path/to/english-sample.wav /path/to/english-reference.txt \
  --output /private/path/new-parakeet-results.jsonl
```

Tests use a deterministic decoder and real loopback sockets without loading
MLX. The benchmark requires a running bridge and explicitly supplied 16 kHz
mono PCM16 WAV. It sends 20 ms chunks at real-time speed, verifies final ordering
and unique sentence IDs, writes functional transcript evidence to a new 0600
file, and prints only metrics. WER ignores case and punctuation; number spelling
remains literal. A short synthetic sample is a plumbing and narrow accuracy
check, not a general accuracy ranking. Native Mimi capture/overlay acceptance
is a separate test.

### Measured on 2026-10-05

Apple M5, 16 GiB RAM, macOS 26.3.1(a), Python 3.12, pinned MLX 0.32.3 and model
revision above. Baseline code `05a2423`, default 480 ms endpoint; WAVs were sent
at real-time speed over the authenticated loopback WebSocket, without capture
or a Mimi UI. These are individual runs, not latency percentiles or broad ASR
accuracy estimates.

| Sample | Duration | Final segments | First draft | First final | EOF to finished | Literal WER |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Synthetic English short | 9.518 s | 2 | 1.013 s | 8.229 s | 130 ms | 1/30 (3.33%) |
| Synthetic English, 24 sentences | 96.263 s | 24 | 0.916 s | 2.975 s | 11 ms | 13/239 (5.44%) |
| whisper.cpp JFK sample | 11.000 s | 2 | 1.025 s | 8.303 s | 137 ms | 0/22 |

The extended sample uses original CC0 sentences, Samantha/Daniel synthetic
voices at 160/190 words per minute, and one-second gaps. It is not a noisy or
accent-diverse speech benchmark. WER uses `re.findall(r"[a-z0-9]+", text.casefold())`;
number spelling differences count as errors. The 11-second JFK clip is a narrow
human-speech check, not a representative real-world corpus.
Inspection of the 24-sentence result attributed all 13 literal errors to equivalent
number, currency, time or date formatting. The short sample instead repeated one
word across its eight-second forced boundary; that is an observed recognition
error, not a formatting difference. The 320 ms trial retained that
repetition. Byte comparisons of the two segments confirmed that PCM was neither
replayed nor dropped at the boundary, including with different packet sizes.

The first observed model load plus silent warmup took 7.992 s. Worker peak
process RSS was 822 MB; that measurement does **not** include all Metal/unified
memory allocation. Baseline decodes took 106–299 ms. On the 24-sentence sample,
final delivery followed the segment endpoint by 115–231 ms (median 134 ms),
in addition to the 480 ms silence wait. Both short samples reached the eight-second
segment limit before their first final, so their roughly one-second previews
must not be presented as one-second confirmed subtitles.

Two simultaneous real-time short-sample replays started within 1 ms of each
other and produced separate task IDs, two finals and WER 1/30 per source. At the
default endpoint, their EOF waits were 96/184 ms. A separate 320 ms endpoint
trial still reached its first final at 8.155 s, with WER 1/30; it does not justify
changing the default. The endpoint option and its focused regression are in
`24fb76f`. A slow or contended machine can exceed Mimi's one-second final grace;
the bridge's longer internal failure deadline is not a promise that Mimi waits
for it. Keep model concurrency and native acceptance as explicit follow-up checks.

## Source and attribution

- Model: NVIDIA [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- MLX conversion: [mlx-community/parakeet-tdt-0.6b-v3](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3),
  revision `ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15`, CC BY 4.0. This changes the
  original weight format for MLX; the bridge does not fine-tune the weights.
- Runtime: [senstella/parakeet-mlx](https://github.com/senstella/parakeet-mlx),
  package 0.5.3, Apache 2.0; source reviewed at
  `2d9748c04aca31405274a13c20ef9b62f1a73351`.

These attributions identify upstream work and do not imply endorsement by
NVIDIA, Apple, or the conversion authors. Package versions and hashes are fixed
in `requirements.lock`; setup records the model revision and downloaded hashes.
