# Standalone FunASR accuracy experiment

Accepted scope: test local ASR quality directly on the user's Mac, using comparable
public English samples. No translation, Mimi provider integration, capture or dev
app modification is part of this experiment.

## Runtime choice

Use official SenseVoiceSmall through FunASR and the official native-Transformers
Fun-ASR-Nano checkpoint, both in CPU FP32 with four threads. This establishes a
reproducible Mac path without assuming CUDA is required or inferring MPS support
from a generic device parameter. ONNX/GGUF/MPS and dedicated Paraformer streaming
remain separate runtime/checkpoint experiments, not silent fallbacks.

Setup is an explicit network step. Pin Python/dependencies, model revisions and
file hashes. The inference stage checks those assets and uses local-only loading,
with update checks disabled and no checkpoint-provided Python execution.

## Isolation and bounds

A parent runner validates manifests/audio and owns one inference subprocess per
model/manifest. Reuse the model across clips to separate startup from warm runs.
A 180-second load deadline and 120-second per-call deadline bound stalled native
code. Normal EOF, SIGTERM/keyboard cancellation and failure reap the owned process group,
including descendants after the leader exits; no
long-lived service remains. The child protocol has a 1 MiB response bound.

Each ordinary clip is at most 30 seconds. The 96-second combined synthetic case
uses contiguous 30-second slices with no overlap, VAD or previous-text prompt.
This deliberately exposes hard-cut errors and does not claim real streaming.
Streaming subtitle integration would require separately tested endpointing,
replaceable drafts, per-source state, cancellation and tail flush; none is
inferred from this experiment's RTF.

## Evidence and comparison

Measure fixed 24 synthetic utterances, 40 LibriSpeech utterances (20 test-clean,
20 test-other, distinct speakers in each group), a familiar 11-second JFK clip,
a 3-second digital-silence negative control, and the combined synthetic audio.
Keep each split and continuous/individual strategy separate. No parameter search
or accuracy-driven sample exclusion follows the results.

Record per-case hypotheses/references only in private external JSONL. Version and
hashes, status, counts and timing are safe in repository reports. Literal WER and
pinned official Whisper-normalized WER are independent columns; retain format
mismatches and inspect materially different outputs. Keep silence insertions out
of speech WER and visible as a separate negative-control outcome.

Sample RSS every 50 ms, label it as process RSS, and report load and decode peaks
separately. First observed startup is not a reproducible hardware-cold claim:
OS page caches and Python import/JIT caches are not cleared. Fixes to tooling must
not rewrite actual hypotheses/timing or remove failed cases.

## Verification

Focused tests cover input hashes/formats, relative-path containment, duplicate
IDs, token scoring, exact PCM chunk coverage, partial protocol reads, output
bounds, EOF, timeouts, signal cancellation and descendant reaping. Summaries reject
failed/aborted runs and check expected case IDs, order and count. A separate CI job runs those tests
without model downloads. Actual model runs establish only the reported macOS
runtime/sample evidence. Main remains unchanged pending explicit review/merge.
