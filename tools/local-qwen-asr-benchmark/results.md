# Measured Qwen3-ASR results — 2026-10-05

Standalone recognition on an Apple M5 / 16 GB Mac, macOS 26.3.1(a), with
official checkpoints and the fixed configuration in [README](README.md).
No Mimi, translation, microphone, system capture or private media was used.

## Offline transcription

Each model was run in a separate process with an exclusive lock. These are
the final serial reruns, with warm file caches; no parameter search was used.
The two versions produced identical hypotheses to their initial offline
passes, but initial timing was excluded after a scheduling overlap.

| Input | 0.6B literal edits / words | 0.6B Whisper-normalized | 1.7B literal edits / words | 1.7B Whisper-normalized |
| --- | ---: | ---: | ---: | ---: |
| 24 synthetic individual utterances | 5 / 239 (2.09%) | 2 / 232 (0.86%) | 5 / 239 (2.09%) | 2 / 232 (0.86%) |
| 20 human test-clean utterances | 6 / 374 (1.60%) | 5 / 372 (1.34%) | 7 / 374 (1.87%) | 3 / 372 (0.81%) |
| 20 human test-other utterances | 10 / 380 (2.63%) | 10 / 380 (2.63%) | 6 / 380 (1.58%) | 6 / 380 (1.58%) |
| 40 human utterances, micro total | 16 / 754 (2.12%) | 15 / 752 (1.99%) | 13 / 754 (1.72%) | 9 / 752 (1.20%) |
| 64 individual utterances, micro total | 21 / 993 (2.11%) | 17 / 984 (1.73%) | 18 / 993 (1.81%) | 11 / 984 (1.12%) |
| 96.263 s synthetic concatenation | 3 / 239 (1.26%) | 2 / 232 (0.86%) | 3 / 239 (1.26%) | 2 / 232 (0.86%) |
| 11 s JFK excerpt | 0 / 22 | 0 / 22 | 0 / 22 | 0 / 22 |

The normalized clean result improves more than the literal result because
normalization is broader than punctuation or number formatting. These are
micro counts on a small fixed sample, not a published benchmark leaderboard.
The 96-second concatenation uses upstream low-energy recursive chunking and
must not be ranked as the same segmentation experiment as fixed 30-second cuts.

| Measurement | 0.6B | 1.7B |
| --- | ---: | ---: |
| Model load + parameter evaluation, cached files | 107.4 ms | 705.3 ms |
| Human 290.79 s processing | 11.819 s | 29.899 s |
| Human RTF | 0.0406 | 0.1028 |
| TTS 24 processing / 72.263 s audio | 4.043 s | 10.006 s |
| 96.263 s default offline chunking | 3.598 s | 9.062 s |
| Process peak RSS, whole run | 1.62 GiB | 2.81 GiB |
| MLX peak allocation, whole run | 2.92 GiB | 7.60 GiB |
| 10 s zero PCM: generated words | 1 | 4 |

Both models hallucinated on silence. The 0.6B result was “The.” and 1.7B was
“I'm not sure.” A production recognizer would need a separately evaluated
speech/no-speech policy; none is hidden in this benchmark. No offline result
exhausted the 512-token budget. File I/O, asset verification, imports and
tokenizer/first-kernel costs are not all included in `load_ms`; do not compare
it to another runner's entire process startup. First-case cost is included in
the TTS aggregate. GPU/system memory is not represented by RSS alone.

## Paced audio and lifecycle

Paced measurements are recorded separately from offline RTF. They use 20 ms
input frames, 2 s decode steps, 30 s context, upstream accuracy finalization,
and the same English/greedy/token limit. The benchmark provides full PCM from
a public file and simulates delivery; it is not a native capture integration.

| 96.263 s paced input | 0.6B | 1.7B |
| --- | ---: | ---: |
| Final literal edits / words | 3 / 239 (1.26%) | 0 / 239 |
| Final Whisper-normalized edits / words | 2 / 232 (0.86%) | 0 / 232 |
| First nonempty text update from feed start | 2,355 ms | 2,913 ms |
| EOF flush after last delivered frame | 105 ms | 217 ms |
| Total elapsed, including real-time pacing | 96.372 s | 96.619 s |
| Maximum delivery lag | 483 ms | 1,096 ms |
| Longest synchronous feed call | 477 ms | 1,089 ms |
| Text updates / rewrites | 48 / 30 | 48 / 29 |
| 10 s paced silence: generated words | 1 | 4 |

The 1.7B final text matched this reference, but its decoder blocked audio
delivery for over a second once. It is premature to call this a production
real-time recognizer. Partial rewrites also show why previews cannot be treated
as durable final captions. The EOF tail in this fixture includes silence, so
these flush times are not a claim about arbitrary speech cutoffs.

0.6B supervisor/worker PIDs were 14051/14053, from
`2026-10-05T05:44:20.392345Z` to `05:46:07.792044Z`; 1.7B was
14171/14173, from `05:46:29.237956Z` to `05:48:18.835465Z`.
Both exited 0 and released the exclusive lock. A subsequent process inventory
found zero benchmark processes and a fresh nonblocking lock acquisition passed.
No model service remains running. The actual cancelled earlier paced worker
was reaped in 22.6 ms; focused tests separately cover deadline cleanup,
exclusive-model rejection and preserving existing lifecycle evidence.

## Scope and provenance

Official model revisions, runtime archive and individual source hashes,
normalizer revision, and exact dependency hashes are committed beside the
runner. Full reference/hypothesis output and per-event timestamps remain
private under `~/.local/share/mimi-local-models/qwen-asr/evidence/`.

Accepted result file SHA256 values:

| File in the private evidence directory | SHA256 |
| --- | --- |
| `mimi-qwen-06-offline-final-20261005.json` | `e5646d4f5ed9ac96910031d58e2b06e10c856de01e0278f1d51f5c59a8b461e4` |
| `mimi-qwen-17-offline-final-20261005.json` | `5a5e29d9602ebf321370c939cef85ada88ac41d138368d96b84167e6f7f114c3` |
| `mimi-qwen-06-paced-final-20261005.json` | `165c802d77ccbd4df6dbc7461fb418f0d1e40362ffe4f4c06b89d645e27cc03f` |
| `mimi-qwen-17-paced-final-20261005.json` | `ee60a0d322b86eb58b9f1b3c5707a97431b458eb8df052991800c69d8e66a3e2` |

One initial 1.7B offline run briefly overlapped an early 0.6B paced launch.
The paced launch was cancelled and reaped in 22.6 ms. Both offline models
were rerun serially after adding an exclusive lock; only those final files
contribute to this report. That correction is retained with the evidence.
Final offline inference used runner SHA256
`9218b2bbd6bfc83cc9cd55419e0b1159ad72850841d408a289412ce20d1f671d`.
Later changes add lifecycle sidecars and protect them from accidental overwrite;
the recognition configuration is unchanged. The 0.6B offline PID was not
recorded and is not reconstructed; its supervisor's successful exit preceded
the 1.7B launch. The 1.7B offline supervisor/worker PIDs were 13865/13867.

This experiment supports considering Qwen3-ASR as a Mac-local recognition
candidate. The larger model improved this small human sample with higher
latency and memory. Other languages, music, overlap, sustained noise, long
sessions and production cancellation/segmentation remain unvalidated.
