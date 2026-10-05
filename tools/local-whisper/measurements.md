# Whisper local trial — 2026-10-05

These are direct WebSocket fixture measurements on an Apple M5 / 16 GB Mac,
macOS 26.3.1(a). They do not measure microphone/system capture, Mimi's overlay,
translation quality, other languages, background music or sustained two-source use.
No model weights, recorded audio, credentials or raw recognition results are in Git.

## Fixed configuration and inputs

Final inference revision: `9dfde940f4b5e3cca00c8c34d364e47a82983f53` (clean).
Later changes only document/install these results and correct the benchmark mode description.
whisper.cpp `927cfce34f31707e17f2bff35c349632fb9e2c3a`, Metal, turbo Q5_0,
greedy / four CPU threads / no previous text context / no translation,
1024 encoder positions, 200 ms energy-gate quiet period, 8 s maximum segment.
Worker SHA-256:
`5fccfe835acb75cdbaca4e4db620de4e5f1657644c36743360d810f25ea91964`.
Bridge SHA-256:
`b1c08a01cd9de713544c8716f128e84152e98ca4d620d07ff758a8b489effb73`.
The installed bridge matched the tested source. Pinned model/archive hashes are
in the installer; the 574,041,195-byte model was downloaded and verified exactly.

| Fixture | Duration | Words | WAV SHA-256 |
| --- | ---: | ---: | --- |
| Original four synthetic English sentences | 9.51825 s | 30 | `bc9ff054aa985fc5ef2ae27e911c7fd25575b78cbf2f3ac09a4f0b67687ead7b` |
| 24 original CC0 sentences, Samantha/Daniel, including 1 s gaps | 96.263375 s | 239 | `11a7bcc363b22afec54de9bcb26bddc84608d58ba505e44b5ccd6168d3ff5a24` |
| Official whisper.cpp JFK sample | 11 s | 22 | `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` |

The 24 sentences cover negation, numbers, names and game dialogue. The JFK sample
is a familiar public recording, not a held-out accuracy benchmark; `fetch_jfk.py`
pins its upstream revision and records its [official speech reference](https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches/inaugural-address-19610120).
All routes in the wider trial use these exact WAVs. Local raw files are named
`benchmark-20261005-context1024.json` and
`benchmark-20261005-context1024-simultaneous-eof.json` in the installation directory.

## Final observed results

Audio is paced at 1× in 20 ms PCM chunks. First draft/final start at the first PCM;
flush is finish-task to task-finished, excluding model setup. WER lowercases and
tokenizes ASCII alphanumeric words (`[a-z0-9]+`); punctuation separates tokens,
while digit/number-word and currency formatting remain distinct. Each result is
one run, not a median or percentile. First final can precede the first draft.

| Input, one connection | Literal WER | First draft | First final | EOF flush | Total replay | Finals |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Four sentences | 2/30 = 6.67% | 4272.6 ms | 2293.9 ms | 290.5 ms | 9810.8 ms | 4 |
| 24 sentences | 15/239 = 6.28% | 2279.7 ms | 2857.9 ms | 1.2 ms | 96265.2 ms | 36 |
| JFK | 0/22 | 2271.0 ms | 8312.8 ms | 290.5 ms | 11291.2 ms | 2 |

The four-sentence differences are number words rendered as digits. All 15 edits
in the 24-sentence run are number/currency formatting; no additional lexical or
repeated-word difference was observed. This does not make the reported WER zero
and does not establish general accuracy. The 24 inputs became 36 confirmed
segments: shorter pauses improve this short-sentence case but fragment some
sentences, which may affect the independently selected translation model.

Warm model load was 286.5 ms; sampled native-worker peak RSS was 752.2 MiB (0.5 s
sampling). The simultaneous-EOF run loaded in 199.0 ms and reached 760.1 MiB.
The first earlier launch took 12.35 s, including initial Metal setup. These are
process measurements, not total unified memory or a cold-boot guarantee; they
exclude the bridge, Mimi and any translation model. Apple Speech consumer RSS
does not include its system model and must not be compared as full model memory.

Two equal-length four-sentence streams were sent concurrently in one event loop.
Their finish-task timestamps were 0.081 ms apart; EOF flush was **457.4 / 735.2 ms**,
both below Mimi's current 1000 ms recognition deadline in this run, with 2/30
formatting differences on each stream. The first entry in that JSON is a separate
single-stream baseline (287.6 ms flush); the two entries with `mode` and `source`
are the concurrent pair. Different-input concurrent four-sentence/JFK streams
also kept their results separate, but their 1.48 s EOF gap is not a simultaneous
finish test. No long-run or resource-contention guarantee follows from these cases.

## Same-input changes and rejected candidate

| Configuration / revision | Four-sentence differences | 24-sentence literal WER | 24-sentence finals | Equal-length dual EOF |
| --- | --- | ---: | ---: | --- |
| 600 ms quiet, default encoder context / `107c1b6` (EOF harness `65ca7bb`) | 2/30; hard cut damaged the final sentence | 16/239 = 6.69% | 24 | 460/915 ms |
| 200 ms quiet, default context / `5f8cc11` | 0/30 | 15/239 = 6.28% | 36 | **1034/1506 ms: exceeded deadline** |
| 200 ms quiet, 512 context / `5977f65` | 2/30; numeric formatting | **27/239 = 11.30%** | 36 | Not accepted or measured |
| 200 ms quiet, 1024 context / `9dfde94` | 2/30; numeric formatting | 15/239 = 6.28% | 36 | 457/735 ms |

The 512 candidate repeated 12 words inside one final result and was rejected;
there is no text deduplication workaround. The hard-cut test preserves the exact
total PCM length, and the segmenter clears preroll at onset rather than replaying
audio from the previous confirmed segment. 1024 restored the observed 24-sentence
quality while reducing padding work. Queued retired previews are skipped; already
running previews remain non-cancellable and can delay finals under other loads.

## Verification and next boundary

- 22 focused tests pass: token/origin/path rejection, independent two-source
  state, third-connection rejection, bounded segmentation and pending work,
  silence/partial EOF, cancellation, worker exit/reaping, stale draft retirement,
  sanitized failures, and false process/listener identity rejection.
- The pinned Metal worker compiled locally. Actual manual launchd start/status/
  stop verified the job, bridge PID/arguments, worker child and exact loopback
  listener; both processes and job were absent after stop. No other service was
  stopped and no app profiles or credentials were edited by the adapter installer.
- The canonical `scripts/check.sh` passed on base `51820ad` before the rebase:
  desktop Rust 1086 passed / 2 ignored, shared-core/JNI, frontend 107 files /
  1416 tests, typecheck/lint/build. After rebasing onto `a0ac37f`, the changed
  adapter's 22 tests and Metal build were rerun; the desktop source is unchanged.
  The adapter workflow adds Linux/macOS protocol tests and a macOS build without
  downloading weights or pretending CI performs real inference.
- Native Mimi system-audio → recognition → independent translation → overlay is
  a separate acceptance step. Noise/quiet speech, multilingual quality, continuous
  hard cuts, long sessions and simultaneous translation-model load remain open.
