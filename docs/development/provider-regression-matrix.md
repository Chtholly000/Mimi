# Provider eligibility and regression matrix

Official eligibility checked on 2026-10-05 against Mimi's implemented APIs in
[`core/protocols`](../../src-tauri/src/core/protocols) and
[`clients`](../../src-tauri/src/clients). Published offers are not proof that an
existing account has credits, model access, or a working Mimi session.

## Exact API and free eligibility

| Service and implemented API | Official free eligibility | Activation conditions and source |
| --- | --- | --- |
| OpenAI: `/v1/realtime/translations`, `gpt-realtime-translate`, with `gpt-realtime-whisper` source transcription | The translation model explicitly does not support the Free tier. | [Model](https://developers.openai.com/api/docs/models/gpt-realtime-translate). New API accounts use prepaid billing, with a [$5 minimum purchase](https://help.openai.com/en/articles/8264644-what-is-prepaid-billing). Access must be from a [supported region](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories); mainland China is not listed. ChatGPT subscriptions do not establish API credit. |
| Azure OpenAI: `/openai/v1/realtime/translations`, separate configured translation and transcription deployments | No dedicated free translation allowance confirmed. The general new-customer $200 / 30-day offer does not establish this model's deployment eligibility or credit applicability. | [Model and pay-as-you-go deployment](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/gpt-realtime-translate); [realtime region prerequisites](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/realtime-audio-websockets) list East US 2 and Sweden Central. [Azure signup](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account) requires a phone and non-prepaid credit/debit card; its global trial excludes Azure China. Model quota is distinct from a free spending allowance. |
| Volcano Engine: `/api/v4/ast/v2/translate`, resource `volc.service_type.10053`, simultaneous interpretation 2.0 in speech-to-text mode | The new speech console offers a first-activation API trial bundle, but the public material inspected did not establish the exact allowance or expiry for resource `10053`. Confirm that resource before testing. | [Official onboarding](https://docs.volcengine.com/docs/DoubaoVoice/QuickStartNewConsole?lang=zh) requires real-name verification; the gift is issued once and is not repeated for new projects. It describes automatic postpaid charging after free resources run out. [Speech console](https://console.volcengine.com/speech/new/overview?projectName=default). Do not substitute Ark token, ordinary ASR, or website-demo allowances. |
| Tencent Cloud: `asr.cloud.tencent.com/asr/speech_translate/<appid>`, `hunyuan-translation-lite` | The ASR billing table explicitly lists **no free allowance** for large-model realtime speech translation. | [Exact API and activation](https://cloud.tencent.com/document/product/1093/127565), [billing](https://cloud.tencent.com/document/product/1093/35686), [real-name prerequisite](https://cloud.tencent.com/document/product/1093/35687). Ordinary ASR and TRTC free packages are different products. The [legacy machine-translation notice](https://cloud.tencent.com/announce/detail/2448) also names this replacement API as having no free allowance. |
| Baidu: `aip.baidubce.com/ws/realtime_speech_trans` | **2 hours after personal real-name verification; 10 hours after enterprise verification; none without verification.** | [Exact API](https://ai.baidu.com/ai-doc/MT/Sl9p2h5k9), [free allowance](https://ai.baidu.com/ai-doc/MT/Tl9pjqsym), [registration, claim and application setup](https://ai.baidu.com/ai-doc/MT/2l317egif). The inspected guide does not list a payment card as a trial prerequisite. Free-package expiry was not confirmed; the paid package's 365-day validity must not be reused as a free-trial claim. |
| xAI: `/v1/realtime?model=grok-voice-latest`, with `grok-transcribe` input transcription | No external-API free allowance confirmed. The current speech-to-speech API price is $0.08/minute. | [Voice API](https://docs.x.ai/developers/model-capabilities/audio/voice), [signup and credits](https://docs.x.ai/developers/quickstart), [billing](https://docs.x.ai/console/billing). The free Console Playground is not evidence of credit for Mimi's API requests. API-specific region or identity prerequisites were not established by this review. |
| DeepL official text translation: `/v2/translate`; legacy `:fx` keys select `api-free.deepl.com`, other keys select `api.deepl.com` | New **API Developer** plan: **1,000,000 characters total, without reset**, no credit card required. Legacy API Free retains 500,000 characters/month but is no longer offered to new subscribers. | [Plan limits](https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans), [no-card onboarding](https://www.deepl.com/en/developers), [Developer signup](https://www.deepl.com/en/signup?cta=checkout&is_api=true&productId=api-developer). This is an independent text stage, not ASR, DeepL Voice, or DeepLX. A separate Developer-plan region list was not confirmed. |

Alibaba and Gemini account eligibility were outside this official-offer review.
Their existing profiles must not be described as newly granted free service.
Apple Speech has no speech API credential or cloud trial balance; local OS,
hardware and prepared-language requirements still apply. A separately selected
text translator retains its own eligibility and billing.

## Native coverage for this audit

Unless a row states otherwise, the native observations below used the signed
canonical `/Applications/mimi-dev.app`, build **`d58f4bad`**, which does **not**
contain this audit's authentication/error-mapping patches. The comparable input
was a fixed 15.091-second synthetic English sample. These observations are not a
complete multiwindow snapshot trace or a complete stop/start/app-restart regression.

| Service / route | Available setup evidence | Current audit status |
| --- | --- | --- |
| Alibaba: default Audio 3.0 ASR (`qwen-audio-3.0-asr-flash-streaming`) → `qwen-mt-lite`; separate realtime adapter uses `qwen3.5-livetranslate-flash-realtime` | Existing profile connected and ran. | Observed RTT 46 ms, MT 446 ms; resume recovery about 0.5 s; latest ASR and MT reached the sample's final sentence. This does not certify every Alibaba route. Patched-build regression pending. |
| Gemini Live: `BidiGenerateContent`, `gemini-3.5-live-translate-preview` | Existing profile. Earlier evidence remains in the [Gemini design record](../plans/2026-10-05-gemini-subtitle-progress.md). | Observed RTT 95 ms; resume recovery about 0.8 s; latest ASR and MT reached the final sentence. Patched-build regression pending. |
| Baidu realtime speech translation | Existing profile connected in 744 ms on `d58f4bad`; six confirmed subtitle groups were visible in the overlay before a generic failure after about 73.7 s connected. | Clean `6ac14bde` identifies the later failure as `BAIDU_UNEXPECTED_SESSION_END`. Clean `5b29d05e` verifies native overlay Retry and pause/resume, but the service still sends END after later silence; see the follow-up evidence below. The underlying service cause and remaining trial entitlement are unproven. |
| Apple Speech + DeepL independent text translation | Saved a new profile using the existing active DeepL API Developer account/key, with the 1,000,000-character total free plan; no new registration. | On `d58f4bad`: connection 1,568 ms, MT 1,324 ms; pause/resume and replay reached the final sentence. Clean `6ac14bde` also retained a working key after app restart and reached the final sentence (connection 1,315 ms, MT 512 ms). These observations do not establish the account's remaining character balance. |
| Apple Speech | This round's resource guidance was exercised on a signed build from clean `d58f4bad`: active-profile navigation from the overlay/settings, running-state locks, explicit prepared-language application, unprepared-language selection without download, and restoration of English. | Settings and overlay guidance verified; tray/error/empty/incompatible/pending-action cases have automated coverage only. No resource re-download or recognition-accuracy claim. See the separate [Apple validation record](../plans/2026-10-05-apple-speech-design.md). |
| Whisper + Index text translation | Existing configured route; ASR check 67 ms, MT check 851 ms on `d58f4bad`. | The 15.091-second sample's final ASR and MT both reached the last sentence. Local ASR was observed to be slow, but end-to-end latency was not measured. Pause/resume was not exercised; this is not a latency or full lifecycle pass. |
| Parakeet | On build `fbf3c06c`, the 16 ms availability check returned unavailable. | Capture was not started. This is an unavailable preflight result, not successful recognition or a native session pass. |
| HyMT / TranslateGemma independent text translation | On build `fbf3c06c`, connection checks returned unavailable: HyMT 6 ms, TranslateGemma 0 ms. | Capture was not started. These are unavailable preflight results, not successful translation or native session passes. |
| Volcano Engine | Signup required a phone number, SMS verification and agreement acceptance. The agreement was not accepted and registration was not completed. | No native test; resource `10053` trial eligibility remains unconfirmed. |
| OpenAI / Azure OpenAI / Tencent Cloud / xAI | No confirmed free allowance for Mimi's exact API; Azure's general trial remains distinct from model eligibility. | No native test this round. |

### Clean `6ac14bde` follow-up

The signed native build from clean `6ac14bde` contains the initial authentication
and error-mapping repairs, but precedes the overlay Retry ACL repair.
Apple Speech + DeepL remained usable after app restart, as recorded above.

Baidu entered running at app uptime 180,569 ms and failed at 243,722 ms: **63.153 s**
later, now classified as `BAIDU_UNEXPECTED_SESSION_END`. After the fixed sample
finished, sent-audio evidence continued to report about 100 buffers / 64,000 bytes
of silence every 2 seconds, with a send 1.146 s before failure. This does not match
a 30-second gap without audio sends and must not be labeled an idle timeout. The
reason the service ended the session is still unproven. The trace was exported
privately; no audio, subtitle content or account identifiers are included here.

The actual overlay Retry action failed. Source inspection identified missing
`session_start` permission in `app-overlay-control`; the old permission regression
also incorrectly forbade it. The ACL/test repair and signed native rerun are
recorded below; this earlier build established classification, not recovery.

### Clean `5b29d05e` Retry verification

The signed canonical native build from clean
`5b29d05ecc75f416a4df5743662ad310879c718f` includes the overlay Retry ACL repair.
After Baidu sent END following the sample, clicking Retry in the actual overlay
reached backend `start_requested` at app uptime 144,584 ms and `listening` at
145,513 ms: **929 ms**. Pause occurred at 153,986 ms; resume at 179,048 ms reached
`listening` at 179,853 ms: **805 ms**. Replaying the same sample reached its final
source and translated sentence in diagnostics. At 227,082 ms the session was
still `listening`, with 11 cumulative `confirmed_pair_events`.

The first session ended after 55.459 s (app uptime 30,408–85,867 ms).
Later silence after recovery again led to END. The service's reason for ending the session
remains unknown; the automatic recovery strategy was not changed. This verifies
the native Retry action and the observed pause/resume path, not a fix for the
service ending sessions or a complete multiwindow trace. Connection recovery
times are not end-to-end subtitle latency.

The final `scripts/check.sh` passed: Rust 1,168 passed / 2 ignored, 72 shared-core
tests plus JNI checks, and 1,730 frontend tests across 119 files, with formatting,
Clippy, lint, typecheck, build and diff checks passing.

Focused automated results are recorded in the
[recovery design](../plans/2026-10-05-provider-recovery-errors.md).
The Android environment issue was resolved: `testDebugUnitTest` completed
successfully with 19 suites / 129 tests and zero failures, errors or skips.
Actual host JNI compilation passed; the run includes 2 shared-core JNI tests,
11 shared translation tests and the 3 new handshake/feedback tests. Android code
was unchanged after that successful run. Android physical-device and Release
validation remain unverified.

Keep account identifiers, keys, provider bodies, recognized/translated text and
private media out of this matrix. Add only observed revisions, route/language
codes, lifecycle results, counts, sanitized reasons and remaining gaps. RTT and
connection recovery time are not end-to-end subtitle latency. This matrix does
not certify Android, Windows or Linux behavior from macOS or local tests.
