# Local recognition and translation: issue #40 research

Status: proposal for a Mimi-managed local service, not an accepted design or
implemented feature. User-managed local text translation already works through
an existing adapter; that is not fully local speech translation.
Reviewed: 2026-10-05. Scope: Mimi desktop; Android needs separate resource and
lifecycle validation. Refs [#40](https://github.com/yuxino/mimi/issues/40).

## Recommendation

Reuse Mimi's existing independent OpenAI-compatible text-translation adapter for
local MT experiments. A loopback llama.cpp server needs no application changes
or translation API key. Recognition remains whatever the selected ASR service
provides; combining cloud ASR with local MT still uploads audio and needs the
ASR service's credentials. The public Index-Translate API documented in the
application README is a remote service, not a local deployment.

For a fully local product, retain one opt-in **Local** service profile backed by
a supervised, persistent native worker. Keep recognition (ASR) and translation
(MT) separate behind that adapter and retain the existing cloud profiles.
Ordinary users should not need Python, Docker, a terminal, Ollama, or an API key.
Ship only after measuring continuous selected-input audio, not after successful
file transcription or a text connection check.

Compare streaming Paraformer through sherpa-onnx and Vosk as lightweight ASR
baselines, then Qwen3-ASR-0.6B and specific FunASR native models as challengers.
Choose language pairs explicitly; not every candidate supports Japanese. Test
Qwen3-ASR-1.7B only where resources permit. For MT, retain Qwen2.5-7B-Instruct and
Qwen3-4B-Instruct-2507 as reproducible general-purpose baselines, and compare
translation-specific Index models and Apple Translation on eligible Macs.
Use the same subtitle corpus and declare each runtime, prompt and quantization;
do not choose a default from parameter count or upstream throughput graphs.

A limited Index-Translate-2B trial now proves the existing hybrid integration,
not acceptable general quality or real-time performance. English-to-Chinese
usage exposed terminology/name errors; the measured evidence and remaining
checks are below. No local ASR, Echo, or Apple Translation benchmark has run.
This PR changes only research documentation and its index: no model artifacts,
dependencies, runtime, settings, capture, or network behavior.

## What the discussion asks for

The issue requests recognition and translation without uploading audio or needing
an API key. Follow-ups propose FunASR, Qwen, Vosk, system translation, VAD tuning
and voice separation. Distinguish the underlying tasks:

- ASR produces source text; it does not by itself provide arbitrary translation.
- MT translates text; a text-only Qwen model cannot consume PCM audio.
- A speech-translation model can combine ASR and MT, but its supported directions
  and audio delivery contract still need verification.
- VAD detects speech and helps decide when an utterance ends; it does not remove
  music, identify the desired speaker, or guarantee transcription accuracy.
- Source separation adds another inference stage; its effect on recognition and
  latency must be measured separately.

“Qwen 0.6B/1.7B” likely means **Qwen3-ASR-0.6B/1.7B**. This is an interpretation
of the comment, not confirmation from its author. Use exact model IDs in tests.

## Current integration points

Source inspected at desktop main `6b83ca12ea34e45517654ce694f2dfa763ab929d`.
The native experiment below used the earlier revision recorded with its results.

| Existing boundary | Reuse / necessary change |
| --- | --- |
| `src-tauri/src/core/provider.rs`, `core/protocols/custom_speech.rs` | Profiles select capabilities and input sample rates. Custom ASR supports specific DashScope and OpenAI Realtime transcription WebSocket protocols, including loopback addresses. An arbitrary HTTP transcription or chat server is not a drop-in ASR provider; advertise only the selected model's languages. |
| `src-tauri/src/settings_store.rs`, `settings_store/file_credentials.rs`, `core/configuration.rs`, `core/credentials.rs` | Normal credentials now use a private local file; OS stores are one-time migration sources. The separate dev preset remains read-only. Recognition still validates credentials. A fully local profile must resolve model readiness before credential access, without a dummy key. |
| `src-tauri/src/clients/translation_client.rs` | Add local recognition dispatch at the facade, which currently validates recognition credentials before provider dispatch. |
| `src-tauri/src/clients/openai_compatible_client.rs`, `core/protocols/openai_compatible.rs` | Existing independent MT accepts loopback HTTP and omits Authorization for an empty key. Reuse its bounded request/response contract. It requests complete non-streaming chat responses with an 8-second per-request timeout; this is a deadline, not a fixed wait, and not an audio protocol. |
| `src-tauri/src/audio/send_pipeline.rs`, `core/audio_input.rs` | Reuse selected-source capture/resampling and bounded ingress. System audio is default; microphone capture is explicit. Keep source lanes, queues and sessions independent. A full ingress queue closes that generation instead of silently losing speech; keep inference off the audio callback. |
| `src-tauri/src/clients/high_quality_client.rs`, `core/preview_pacing.rs` | Alibaba/custom ASR can feed independent MT. Reuse preview pacing and final ordering; do not repoint Qwen-MT's wire protocol at generic chat. Queue/pacing time and ASR endpointing are distinct from the displayed translation-request duration. |
| `shared/mimi-core/`, `src-tauri/src/clients/provider_events.rs`, `core/subtitle_reducer.rs` | Common subtitle alignment and final-translation policy now live in the shared Rust core used by desktop and Android JNI. The desktop reducer is an adapter. Adapt worker events and preserve replaceable drafts, authoritative finals and source identity. |
| `src-tauri/src/session_manager.rs` | Own worker startup, cancellation, pause/resume, generation invalidation and shutdown. Local overload/OOM must not enter endless cloud-style reconnect loops. |
| `src/lib/providerCapabilities.ts`, `src/lib/providerCredentials.ts`, `src/windows/settings/` | Show model readiness instead of credential errors, expose only supported languages, and localize new strings through existing i18n. |

Avoid a general plugin-framework rewrite or a second subtitle reducer. Extend the
existing ASR/MT boundaries and shared policies. Android already has independent
text providers, but that does not establish on-device model execution, desktop
custom-ASR parity, or mobile resource suitability; retain the distinctions in
[platform parity](../development/platform-parity.md).

## Candidate assessment

Sources below were reviewed on the review date. Runtime support is not proof of
Mimi packaging, language quality, or acceptable latency on a specific device.

### Recognition

| Candidate | Evidence and role | Main limitation to test |
| --- | --- | --- |
| Streaming Paraformer + sherpa-onnx | Documented online Chinese/English and Chinese/Cantonese/English models, including int8 variants [1]. Native lightweight baseline. | Not a Japanese/Korean solution. Verify model-specific license, endpointing, quantization quality and native builds. |
| Vosk | Offline streaming API and small models, including the 40 MB Apache-2.0 English `vosk-model-small-en-us-0.15` [12]. Add the candidate requested in the PR discussion. | Small downloads do not establish recognition quality for game names, noise or accents. Upstream memory guidance is not a Mimi measurement. |
| Qwen3-ASR-0.6B / 1.7B | Official multilingual family; official Python streaming still requires vLLM and excludes batch inference and timestamps [2]. Native Transformers exports also exist. | File inference support is not a desktop continuous-audio transport. Measure partial stability, silence behavior and simultaneous MT. |
| sherpa-onnx Qwen3-ASR / Fun-ASR-Nano | Qwen3-ASR-0.6B int8 conversion and a VAD simulated-streaming example now exist; Nano also has an int8 offline path [13]. | Qwen's example uses an offline recognizer behind VAD. Segmented decoding is not native incremental ASR; conversion quality and finalization latency need measurement. |
| antirez/qwen-asr | Community C implementation for both Qwen sizes, PCM stdin and chunked streaming with rollback; CPU Accelerate/OpenBLAS and CUDA/ROCm paths [3]. | No MPS backend is documented. Default chunks are 2 seconds; stable tokens are not sentence-final events. Test native packaging and model fidelity independently. |
| FunASR native SenseVoice / Paraformer / Nano | Official native llama.cpp/GGUF paths complement the online SDK [7]. SenseVoiceSmall covers Chinese, Cantonese, English, Japanese and Korean; base Nano covers Chinese/English/Japanese, while MLT-Nano is a separate multilingual model. | Current native CLI transcribes files; its HTTP wrapper launches a subprocess per request. VAD/window-based SRT is not Mimi's continuous partial/final contract. It needs a persistent adapter and model-specific tests. |
| whisper.cpp | Native alternative with a real-time stream example [4]. Useful multilingual comparison. | The demo repeatedly decodes windows. Revisions, overlap and deduplication need an adapter; do not replace Mimi capture with its microphone demo. |

FunASR is a toolkit/family, not one interchangeable model. Neither its online
Paraformer SDK nor a model family's language list applies automatically to every
checkpoint. Native Transformers exports likewise do not supply Mimi's audio
transport or subtitle event contract. Keep the model, runtime and endpointing
method separate in every result.

### Text translation and combined speech translation

| Candidate | Evidence and role | Main limitation to test |
| --- | --- | --- |
| Qwen2.5-7B-Instruct | Comment-requested general-purpose MT baseline; Apache-2.0 model card [5]. | Instruction following does not guarantee subtitle quality; test memory, added commentary, omissions and backlog. |
| Qwen3-4B-Instruct-2507 | Smaller Apache-2.0 general-purpose comparison [6]. | Retain as a pinned baseline, not a claim about the latest or best model. Judge names, negation and adequacy blindly. |
| Index-Translate-2B / 9B | Translation-specific text models with official GGUF artifacts [14]. The 2B Q4_K_M model has a limited Mimi trial below. | Trial terminology errors and variable request times prevent recommending it as a default. Upstream language coverage and benchmarks are not per-pair acceptance. |
| Apple Translation | On-device text translation on supported macOS versions and language pairs [16]. Useful system-provided MT comparison. | Requires a Swift bridge, language readiness and lifecycle checks; not ASR and not a verified Windows/Linux solution. |
| Index-Echo S2TT | Combined audio encoder, connector and translation decoder; published file pipeline produces bilingual timestamped subtitles [15]. | Not an ASR-only drop-in. The released CLI documents Chinese to English/Japanese/Spanish, not the English-to-Chinese case needing improvement. Continuous Mac inference is unverified. |

For developer-managed MT, llama.cpp [8] and Ollama's OpenAI-compatible endpoint
[9] can use Mimi's existing text adapter. Their chat APIs are not OpenAI Realtime
audio. Loopback placement alone does not prove a server never forwards content.

**Echo is a separate experiment.** Its decoder already performs translation, so
serially adding Index-Translate is not the default combination; it would need a
specific correction/retranslation purpose and another quality/latency test.
Upstream evaluation includes English-to-Chinese, but the released inference
script does not expose Chinese as a target. That is a released-interface limit,
not proof the weights cannot translate English. Changing prompts would be an
unverified experiment. The documented BF16 reference uses about 10 GB of GPU
memory on an NVIDIA A100; it is not an Apple Silicon requirement or measurement.
The Echo GGUF package contains the text backbone, not the audio encoder and
connector, and cannot run the complete speech pipeline in llama.cpp [15]. No
Echo model or Mac inference was run in this investigation.

**Apple Translation needs a platform adapter.** The flexible Translation API is
available on macOS 15+, with a SwiftUI-anchored session and system consent for
missing language downloads. On macOS 26+, `TranslationSession(installedSource:target:)`
can operate without a SwiftUI translation task when languages are already
installed; it cannot request download permission itself. Query
`LanguageAvailability` for the actual pair and installed state [16].
On macOS 26.4+, record the selected strategy: `.lowLatency` uses traditional
models for latency-sensitive work; `.highFidelity` can use Apple Intelligence
and may take longer, falling back to traditional models when Apple Intelligence is unavailable.
Record OS/SDK, strategy and availability rather than assuming system translation
is faster or more accurate. Apple documents on-device translation but may collect
non-content API usage/performance metrics, so this is not a zero-telemetry claim.

Apple manages its own language assets and updates; Mimi cannot promise the same
artifact pinning/hash control as a bundled worker. Complete any consented system
download before listening. No corresponding Mimi integration has been verified
on Windows or Linux. Edge's on-device Translator API is a separate browser
candidate [17]; browser support does not establish availability in Mimi's
embedded WebView2 or WebKitGTK.

**Memory planning, not device requirements:** nominal 4-bit weights alone cost
approximately parameter-count / 2 bytes: 4B ≈ 2 GB and 7B ≈ 3.5 GB (decimal).
Artifacts also contain scales and mixed-precision tensors. Peak memory includes
ASR, activations, KV cache, runtime, GPU allocations and the OS. Do not promise
8 GB support or derive working memory from a GGUF's file size. Measure concurrent
ASR/MT while video is playing, including memory pressure and swap activity.

## Why a managed native worker

| Approach | Advantage | Cost / decision |
| --- | --- | --- |
| Persistent Mimi-managed worker | No user-managed server; native libraries stay out of the UI process; one lifecycle and IPC contract | Proposed product shape. Requires per-platform packaging, signing, supervision and model management. |
| User-managed loopback services | Existing MT adapter already enables local text experiments | Server installation, protocol differences and model readiness burden users. Arbitrary local ASR still needs an adapter; no fully local claim from a hybrid session. |
| OS translation framework | System-managed language assets on supported devices | Platform/language/version limits, system download consent and different lifecycle/privacy boundaries; benchmark separately. |
| Direct Rust/native linking | Fewer processes and potentially lower IPC cost | Possible later optimization; native crashes/GPU failures share the app process and complicate every platform build. |

Proposed flow, independently for each selected source:

```text
existing selected-input capture -> bounded source-specific PCM ingress
  -> local worker: endpointing + ASR -> replaceable source draft
                                   -> committed source utterance
  -> bounded serial local MT queue -> final source/translation pair
  -> existing provider events / shared subtitle core / overlay
```

Start with a worker executable that keeps the selected models loaded throughout
the listening session, using bounded source-specific queues. Never reload weights
or launch a process per utterance. Whether engines need separate child processes
is a later crash-isolation/resource decision. Preserve independent recognition
sessions and source identity; never mix system and microphone audio. Selecting a
microphone and starting capture remain explicit actions.

Use private inherited pipes (or equivalent private local IPC), a version
handshake, framed PCM and size-bounded messages. Include session generation,
source ID, utterance ID, revision, sample range and partial/final status. Reject
old generations and duplicate finals. Worker stdout is protocol data; diagnostics
must not include recognized text, translations, audio, prompts or private paths.
Do not expose a public listening port.

Validate models and start the worker before opening selected inputs. On stop,
flush with a bounded deadline, cancel remaining work and reap the process. Pause
must not replay accumulated audio on resume. Model/language switching invalidates
the old generation before loading the replacement. Retry a worker crash at most
once with backoff, then show an actionable error. Never silently switch to cloud.

Bound PCM by duration/bytes, utterances by duration/text length, MT context by
tokens, and outputs by tokens/bytes/time. Drop stale previews first on overload.
If confirmed work still exceeds the queue, stop with a clear cannot-keep-up state
instead of silently dropping finals or growing delay. Offer original-only mode
as an explicit choice. Preserve shared final deadlines, cancellation and ordering.

For the first local ASR+MT experiment, translate committed utterances and show
source drafts immediately. Reuse existing MT prompt/context and response-filtering
contracts for comparable tests; a model-specific prompt change needs a separately
versioned comparison. Treat spoken instructions as text to translate. Never
rewrite confirmed history or let speculative previews starve finals. Enable MT
previews only after measuring spare capacity and the existing pacing overhead.

## Model delivery and user experience

A proposed Local profile should show supported languages, download size, measured
hardware guidance when known, and separate recognition/translation readiness.
First offer original subtitles; require MT only when needed. Preserve opt-in
selection and existing profiles/defaults, with no automatic cloud fallback.

For Mimi-managed models, show source, exact revision, license and size before
download. Resume safely, verify hashes and activate atomically. Provide import,
retry and deletion. Validate the manifest, architecture/runtime compatibility,
archive paths, tokenizer/projector assets and disk space. Never treat an imported
hash manifest as executable authority or enable arbitrary remote-code loading.
Runtime binaries use the signed app update path, not the model downloader.
Do not update models during an active session. OS-managed assets follow their
separate framework permissions and versioning limits described above.

The proposed fully local worker must operate after provisioning with external
networking blocked, without credential reads, uploads, telemetry or fallback.
Disable runtime auto-download/check-in paths and test child processes too; a
process boundary is not a network sandbox. Verify OS-framework behavior separately
before making the same claim about it.

Keep working buffers bounded. Subtitle retention and selected-input recording
are independently off by default. When enabled, the current product writes
bounded confirmed text and selected audio incrementally to private session files;
export is not the only persistence path. Disabling an option clears its current
session content, while saved sessions require explicit deletion. Preserve those
rules and source identity for local providers too.

## VAD and source separation

Start with the chosen runtime's endpointing or evaluate Silero VAD [10]. Keep
speech probability threshold separate from end-of-speech silence and pre-roll:
a high threshold can remove quiet speech; trailing silence delays final text.
“More accurate” is not a single meaningful slider.

Proposed advanced controls are speech sensitivity and sentence-end delay with a
reset to model-tested defaults. Preserve pre-roll/trailing audio, force bounded
splits for uninterrupted speech, and test soft consonants, breaths, sentence
endings, rapid turns, music and silence. Local controls must not imply control
over a cloud provider's VAD.

Defer separation from the MVP. It can add lookahead, CPU/GPU contention and speech
distortion, and does not necessarily select the intended speaker. Demucs is an
offline comparison, but its original repository is archived [11]. Evaluate paired
raw/processed audio, including quiet speech and overlap; ship default-off only
if ASR gains survive an end-to-end latency/resource test.

## Measured evidence: limited hybrid Index trial

On 2026-10-05, signed Mimi `cd871ca9eb5a73b57500e1347fd213026f983049` ran on
Apple M5 / 16 GB with Alibaba cloud ASR and local Index text translation. This
was a connection/short-sample trial, not a controlled model comparison. No
application logic changed. System audio only was selected; microphone, subtitle
retention and audio recording remained off. Private media/transcripts are not
included here.

- Model: official `IndexTeam/Index-Translate-2B-GGUF`, revision
  `449c9e6457b3632d328c6cbb78ae8e8e0c8059a5`, Q4_K_M, 1,312,164,352 bytes;
  SHA-256 `044b313d29342bd3b2c77cbb64023ca0d209bd9b3247763f9d162767ef2d746a`.
- Runtime: llama.cpp `b11146` / `7fe450e19`, Apple Metal, loopback HTTP without a
  translation key. Temperature 0, thinking/request logs disabled, output limit
  512 tokens, total context 8192 with two 4096-token slots.
- Six generated short Chinese/English/Japanese text cases used Mimi's request
  format and completed in **354–933 ms**. Two concurrent requests completed in
  **645/667 ms**. These are request durations, not speech-to-subtitle latency;
  the small set did not provide a scored quality estimate.
- A 9.248481-second locally synthesized Japanese sample
  (`index-ja-system-smoke-20261005`) was played through real system capture.
  The native overlay displayed the expected Japanese/Chinese pair. Its latest
  MT request showed **2.0 s**, excluding ASR endpointing, queueing and other
  end-to-end costs. Sample SHA-256:
  `c3966ab0eed4ef55dc03a550ab1900e617439b095677b6fd86c117711d5a2ddb`.
- Subsequent English-to-Chinese use exposed game terminology and proper-name
  errors, with recognition errors also observed. No fixed reference corpus or
  paired ASR/MT ablation was available: the individual error causes and rates
  remain unmeasured. Short synthetic success does not establish usable quality.
- Later direct requests translating the complete synthetic Japanese text took
  **3827/3149/3327 ms**, roughly **6.7–7.0 output tokens/s**. This differs from
  the initial short inputs and machine state: about 15 GB RAM used, 23 GB swap,
  warning-level memory pressure and observed swap-in. These observations cannot
  isolate model, quantization or hardware as the cause, nor prove Mimi queueing
  occurred in the direct HTTP tests. Free disk space is not free working memory.
- Start/stop of the user-managed server was checked. It was subsequently stopped
  at the user's request; downloaded weights/caches were retained. This was not
  acceptance of a Mimi-managed worker lifecycle. Echo preparation stopped before
  dependency installation, weight download or inference.

The experiment establishes only that existing MT configuration can connect to
this local server and render a hybrid result. Local recognition, offline audio
privacy, a 30-minute run, controlled latency percentiles, independent quality
scores and other platforms are **not run**. The proposed gates below remain
unapproved targets, not results achieved by this trial.

## Reproducible experiment and decision gates

1. Use licensed or consented, non-private fixtures with reference transcripts and
   reviewed translations: English -> Chinese, Japanese -> Chinese and Chinese ->
   English, plus code-switching, names, music, quiet speech and silence. Prioritize
   English -> Chinese after the observed failures. Record hashes/rights; keep
   private captures and subtitles out of Git.
2. Pin model revision/hashes, quantization, runtime/build flags, prompt hash, VAD,
   OS, CPU/GPU, RAM, power mode and threads. For OS-managed models record framework
   version, strategy and readiness instead of claiming a pinned weight revision.
   Compare MT on identical reference text, then repeat on ASR output to separate
   recognition errors from translation errors.
3. Warm models and feed 16 kHz mono PCM16 at wall-clock speed through an isolated
   harness. Unrestricted file decoding is a separate throughput experiment.
   Record event timing/counts without transcript content in diagnostics.
4. Run ASR alone and ASR+MT while playing video. Measure cold/warm load, first
   partial from speech start, source/translated final from utterance end, p50/p95,
   real-time factor, process-tree memory/VRAM, swap pressure, CPU/GPU, thermal
   behavior and queue age/depth. Report HTTP duration separately from total wait.
5. Score CER/WER with declared normalization, partial rewrites and silence
   hallucinations. Blind-review MT adequacy, omissions, names, negation,
   punctuation and added explanations; include quantized-vs-reference output.
6. Run at least 30 minutes plus stop/start, pause/resume, language/source changes,
   worker kill, missing/corrupt model, full disk, OOM/overload and external network
   blocking. Require bounded memory/queue age, independent source lanes, no stale
   publication and no leftover workers. Do not start microphone capture for a
   system-only test.

Suggested go/no-go targets (to approve before measuring): p95 first source draft
within 1.5 seconds of speech start, p95 translated final within 3 seconds of
utterance end, sustained real-time factor below 0.7 for compute headroom, and no
monotonic backlog over 30 minutes. Judge short/long utterances separately. Report
failures honestly; a 2-second ASR chunk setting is not a measured 1.5-second draft.

Use at least 100 reviewed utterances per language pair for an initial quality
screen. Proposed gate: at most 5 utterances with major meaning errors and zero
critical polarity/number/name reversals in the designated regression set. Report
denominators/categories; this is not a population quality estimate. Select the
smallest combination that passes both quality and latency.

| Target | Required evidence | Current result |
| --- | --- | --- |
| macOS Apple Silicon | 8 GB and 16+ GB separately; signed dev app, selected-input capture and managed worker lifecycle | M5/16 GB hybrid cloud ASR + local MT short trial only; fully local and sustained tests not run |
| Windows x64 | CPU baseline, optional GPU, actual desktop loopback and package boundary | Not run |
| Linux x64 | CPU baseline and actual PulseAudio/PipeWire-Pulse monitor session | Not run |
| macOS Intel / Windows ARM64 | Native build, packaging and long-session acceptance | Not run |

Archive numerical results with revisions/commands and maintain the
[integration run ledger](../development/integration-runs.md) for subsequent native
runs. CI can check IPC, queues, shared subtitle policy, cancellation and fake-worker
crashes; it cannot establish hardware suitability or translation quality. A
behavior PR must run `./scripts/check.sh` and native acceptance on each advertised
platform, preserving signing and user data boundaries.

## Proposed delivery sequence

1. Keep using the existing MT adapter for controlled text comparisons. Build an
   isolated ASR harness; include English/name/noise fixtures before choosing a
   model or distributing artifacts. Compare Apple's MT separately on eligible Macs.
2. Implement Local original subtitles on the first passing desktop target with
   credential-free configuration, persistent model lifecycle and failure handling.
   Scope languages to the model and identify this stage as ASR-only.
3. Connect the passing local ASR to the existing MT contract after paired quality
   and concurrency checks. Only then describe fully local translated subtitles;
   add platforms as proven. Echo remains a separate direction/runtime experiment.
4. Add VAD controls after measured presets. Keep separation a separate experiment
   requiring a demonstrated benefit.

Merging this research would not complete or close issue #40. Initial languages,
device floor and the default ASR/MT combination remain undecided. This proposes
an integration shape and records limited evidence, not a release date or a claim
that local quality already matches cloud services.

## Sources

1. [sherpa-onnx online Paraformer models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/index.html) and [runtime](https://github.com/k2-fsa/sherpa-onnx).
2. [Official Qwen3-ASR README and streaming restrictions](https://github.com/QwenLM/Qwen3-ASR#streaming-inference).
3. [antirez/qwen-asr runtime and streaming contract](https://github.com/antirez/qwen-asr).
4. [whisper.cpp stream example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/stream).
5. [Qwen2.5-7B-Instruct model card](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct).
6. [Qwen3-4B-Instruct-2507 model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507).
7. [FunASR model families](https://github.com/modelscope/FunASR), [online SDK](https://github.com/modelscope/FunASR/blob/main/runtime/docs/SDK_tutorial_online.md), [native runtime](https://github.com/modelscope/FunASR/tree/main/runtime/llama.cpp), and [MLT-Nano model card](https://huggingface.co/FunAudioLLM/Fun-ASR-MLT-Nano-2512).
8. [llama.cpp](https://github.com/ggml-org/llama.cpp).
9. [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).
10. [Silero VAD](https://github.com/snakers4/silero-vad).
11. [Demucs repository and archive status](https://github.com/facebookresearch/demucs).
12. [Vosk offline streaming API](https://alphacephei.com/vosk/) and [model table](https://alphacephei.com/vosk/models).
13. [sherpa-onnx Qwen3-ASR](https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/pretrained.html) and [FunASR-Nano](https://k2-fsa.github.io/sherpa/onnx/funasr-nano/pretrained.html).
14. [Index-Translate official README](https://github.com/bilibili/Index-Translate/blob/main/README_zh.md) and [2B GGUF](https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF).
15. [Echo S2TT inference](https://github.com/bilibili/Index-Translate/blob/main/inference/echo-s2tt/README_zh.md), [full model](https://huggingface.co/IndexTeam/Index-Echo-S2TT-2B), and [GGUF limitations](https://huggingface.co/IndexTeam/Index-Echo-S2TT-2B-GGUF).
16. [Apple TranslationSession](https://developer.apple.com/documentation/translation/translationsession), [installed-language initializer](https://developer.apple.com/documentation/translation/translationsession/init(installedsource:target:)), [LanguageAvailability](https://developer.apple.com/documentation/translation/languageavailability), [WWDC24 lifecycle/downloads](https://developer.apple.com/videos/play/wwdc2024/10117/), [lowLatency](https://developer.apple.com/documentation/translation/translationsession/strategy/lowlatency), and [highFidelity](https://developer.apple.com/documentation/translation/translationsession/strategy/highfidelity).
17. [Microsoft Edge Translator API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api).
