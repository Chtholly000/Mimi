# Whisper local trial — 2026-10-05

These are direct WebSocket fixture measurements on an Apple M5 / 16 GB Mac,
macOS 26.3.1(a). They do not measure microphone/system capture, Mimi's overlay,
translation quality, other languages, background music or sustained two-source use.
No model weights, recorded audio, credentials or raw recognition results are in Git.
This is an experimental adapter, not the recommended replacement for Parakeet in
the current English → Index trial: a later independent-final translation check
found a meaning-changing negation error caused by the shorter segmentation.

## Fixed configuration and inputs

Final inference revision: `9dfde940f4b5e3cca00c8c34d364e47a82983f53` (clean).
Later changes document/install these results, correct the benchmark mode label,
and fix launchd startup inspection and the post-ready worker-failure exit code;
the decoding and segmentation used for these measurements are unchanged.
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

The subsequent offline chain check confirmed that risk. Each final was sent
separately to the existing Index 2B Q4_K_M service (llama.cpp b11146 / `7fe450e19`,
alias `index-translate-2b`), using Mimi's existing generic prompt, English →
Simplified Chinese, temperature 0, max_tokens 256 and seed 42, without context,
joining or corrections. On fixture `en-06`, Whisper finals 8/9 split the timer
instruction from its corrective negation, arriving 1.224 s apart. Index translated
the second fragment as a less-than comparison, changing the intended exclusion
of the other number. The complete reference and the Apple/Parakeet complete-
sentence inputs preserved that correction in this run. Thus the formatting-only
ASR WER does **not** imply correct translated subtitles. This configuration remains
experimental for that use; no parameter or text-specific repair was added after
observing the failure.

All 110 chain requests (26 Apple + 24 Parakeet + 36 Whisper + 24 reference)
returned nonempty HTTP 200 / stop responses. This was an unblinded qualitative
review of saved public-fixture finals, not a percentage accuracy score or native
acceptance; draft scheduling and overlay behavior were not replayed. Evidence
JSON SHA-256 is `895a932b4958b0e4b96930da5ca611c8d7fcd8b3112d791b21ffa03440557c7c`;
the source Whisper benchmark SHA-256 is
`3ee938dbcdcfad4771fab8c9e11e26ecea1609b6f6ceea292e2053624243cfef`.
Full text remains outside Git in the task's local evidence archive.

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

- 26 focused tests pass: token/origin/path rejection, independent two-source
  state, third-connection rejection, bounded segmentation and pending work,
  silence/partial EOF, cancellation, worker exit/reaping, stale draft retirement,
  sanitized failures, and false process/listener identity rejection. The actual
  Mimi Audio3 request shape, including its nonempty input context, heartbeat,
  punctuation parameters and automatic-language omission, is covered explicitly.
- The pinned Metal worker compiled locally. Actual manual launchd start/status/
  stop verified the job, bridge PID/arguments, worker child and exact loopback
  listener; both processes and job were absent after stop. No other service was
  stopped and no app profiles or credentials were edited by the adapter installer.
- A subsequent native startup exposed a verified race: immediately after
  bootstrap, launchd reported `state = xpcproxy` and `ps` reported this job's
  `xpcproxy` command before Python exec. The old controller called that an identity
  mismatch. It now recognizes only that exact, job-verified transition as starting;
  Python, worker and listener still must match before ready. Wrong proxy/job/process
  identities remain rejected. A separate regression makes post-ready worker failure
  exit nonzero after cleanup, while explicit stop remains successful.
- The canonical `scripts/check.sh` passed on base `51820ad` before the rebase:
  desktop Rust 1086 passed / 2 ignored, shared-core/JNI, frontend 107 files /
  1416 tests, typecheck/lint/build. After rebasing onto `a0ac37f`, the changed
  adapter tests and Metal build were rerun; the desktop source is unchanged.
  The adapter workflow adds Linux/macOS protocol tests and a macOS build without
  downloading weights or pretending CI performs real inference.
- The post-ready failure fix was also exercised against the installed service:
  after verifying the job, bridge, exact child argv and listener, only the owned
  worker was terminated. The bridge exited with code 1 and the worker was reaped.
  A subsequent new start/status/stop succeeded and left no owned processes/job.
  Installed bridge SHA-256 was
  `28291691ab8cfadb950cbbd7905676935ade9663d164312449b8a847b73de8ab`,
  status inspector SHA-256
  `4d78878dd0aed1659c1f91cd11a017899ff9aa0445a853944491e3388cfa5778`;
  both matched revision `688619e`. Worker/model/decoding settings were unchanged.

## Native short-case follow-up

The coordinated signed Mimi dev build at app revision `9d3a6e4` (Apple Speech
branch; its Custom ASR path matches main) completed a real system-only trial.
App binary SHA-256:
`ba1099d67b3b1e78c6f7c5637ad65e1e8433615b0911ca3f21af7663b48d206f`.
The ASR connection check took 33 ms; that is task setup, not recognition latency.
The fixed 9.518 s public WAV was played with `afplay`, captured through macOS
ScreenCaptureKit, recognized by Whisper and translated by the running Index
service. Native diagnostics received a final original/translation pair including
the last sentence's two quantities. The session was stopped through Mimi UI.
No microphone, subtitle-history retention or audio recording was enabled.

This native trial used the measured bridge hash `b1c08a01…` and final worker hash
`5fccfe83…`, with the corrected startup inspector; the later worker-exit-code
change was verified separately above. It does not claim that every change in the
final PR HEAD was present in the native binary. The complete overlay was not
visually inspected, so full overlay/UI acceptance remains open. Noise/quiet speech,
multilingual quality, continuous hard cuts, long sessions and sustained dual-source
use under simultaneous translation-model load are also unverified. This short
successful transport case does not overturn the independently observed segmented
negation translation failure.


## Japanese direct chain and failure diagnostics — 2026-10-05

One existing macOS Kyoko synthetic Japanese fixture was reused without playback
or capture. Source ID `index-ja-system-smoke-20261005`, 9.248481 s, AIFF SHA-256
`c3966ab0eed4ef55dc03a550ab1900e617439b095677b6fd86c117711d5a2ddb`.
macOS afconvert produced 16 kHz mono PCM16 WAV, 9.2485 s, SHA-256
`9fae54b074b31f84e9c07ec4dcf89e65b71cecec893bcddf5464c0c39ea9f4a9`;
RMS 1881.497 PCM16 and 144221 nonzero samples established actual non-silent input.
The original metadata did not retain a text reference, so no accuracy score is
reported. This is the existing same fixture, not a replacement selected after failure.

The first direct replay failed with a generic RuntimeError; the old wrapper did
not preserve a more specific cause. The installed service remained alive. The
old bridge collapsed all session exceptions to `SERVER_ERROR/local_asr_failed`,
so this event cannot now be relabeled as a proven queue or inference failure.
A subsequent replay completed while an unrelated Parakeet service was resident
and the Mimi capture/test state was not isolated. Four finals arrived, first at
5051.1 ms, total 19431.8 ms, EOF flush 10183.0 ms: far beyond Mimi's 1 s finish
budget. Those timing boundaries are from first PCM and finish-task respectively.

After Parakeet was normally stopped, Mimi's caption session was verified off,
and only the Whisper service was restarted with safe failure diagnostics, the
same paced Japanese replay produced four finals and one draft: first final
2698.1 ms, total 10023.3 ms, EOF flush 773.8 ms. Automatic-language and explicit
Japanese empty sessions, including nonempty Audio3 input context, both completed
setup/finish. Empty setup is not an automatic-language recognition test.
The isolated run used the unchanged worker `5fccfe83…1964`, model and decoding
settings; the diagnostic bridge hash was
`04e23330d57db64d04c5d1b153a509bccf508caa0f19ffef4ed9b6d276209987`.
These were single runs with changed contention, restart and warm state, not a
controlled causal comparison. Another Rust build was still active; system swap
was about 5.76 GB. No other process was stopped by the Whisper diagnostic task.

The four saved finals were then sent separately to the existing Index service
using Mimi's exact Japanese → Simplified Chinese generic request shape. All four
returned HTTP 200 / stop / nonempty responses in 390.3, 212.0, 132.5 and 199.4 ms.
ASR and these translations were sequential phases, not native end-to-end timing.
The translated fragments retained the intended overall meaning in this synthetic
case, but a mid-sentence topic fragment became an awkward standalone Chinese
fragment. This does not establish reliable segmentation or broad Japanese quality.
Native Japanese system capture, full subtitle rendering and sustained use still
need separate verification; the earlier English negation defect remains relevant.

Code review also found an independent deterministic defect: an empty final
following a published preview raised a fatal session error. It now emits the
empty final and the existing empty sentence-begin boundary at the next ID to
retract the preview, then continues; the next real segment reuses that ID.
Two consecutive empty finals followed by a real final and empty EOF are covered
through the actual WebSocket protocol. This is not a proven explanation for the
first generic Japanese failure, and no draft is promoted into confirmed text.

The follow-up patch exposes only exact source-owned failure categories:
`final_backlog/worker_busy` → `LOCAL_ASR_OVERLOADED`;
`worker_timeout/finish_timeout/TimeoutError` → `LOCAL_ASR_TIMEOUT`;
`language_unsupported` → `UNSUPPORTED_LANGUAGE`. Unknown exceptions remain
`SERVER_ERROR/local_asr_failed`. No model parameter, queue bound or deadline was
relaxed. Failed fixture replay now retains safe provider labels and preceding
fixture events in the explicitly requested private file, including when the
server closes immediately after task-failed; stdout omits those text events.

Validation: 33 adapter tests, Python compilation and diff checks. New tests cover
Japanese/context acceptance, deterministic bounded final backlog, timeout worker
retirement, exact code mapping, unknown-message filtering, and real WebSocket
failure/close ordering. This Python/docs-only follow-up reuses the prior full
application/Metal baseline; it does not claim a new full native application run.
Private evidence SHA-256: slow replay
`5236ca2721330c08f15c617a2f0634d6984be1950da95e9a8b039ba0a90e3265`,
isolated replay `ec1be776afc8df274b338f426f2eb3aad5e709c29b0a4f2c201c684d4a67d775`,
Index finals `b4885e62a1f3746c0f83180bad077d7f0f3b3d590931b61c5a35b1b04f0f5cd2`.
Audio, fixture text and results remain outside Git in mode-0600 temporary evidence;
this follow-up has not yet been archived as a durable reusable baseline.
