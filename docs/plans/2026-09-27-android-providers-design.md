# Android service parity and configuration

## Scope and decision

Bring the eight desktop service identities and their streaming contracts to native Android: Alibaba Cloud, OpenAI, Gemini, Azure OpenAI, Volcano Engine, Tencent Cloud, Baidu and xAI. Existing DashScope/OpenAI credentials and appearance preferences remain intact. The request is to synchronize integrations, not to copy desktop secrets. Only user-provided Android credentials may be used for live tests.

Choose a compact service list with a separate focused editor over an eight-tab form or a setup wizard. A configured row activates the service immediately; its settings button opens editing. An unconfigured row opens the editor. The editor presents provider-specific required fields, encrypted saved-credential status, and one Save and use action. Endpoints/models are optional advanced controls only where the contract supports them. Do not expose stored secrets in text fields or persist unsaved form contents in activity state. Appearance remains a separate auto-saving tab.

## Implementation

A pure Kotlin provider catalog defines stable IDs, credential fields, sample rates, supported source/target languages and defaults. Provider changes normalize unsupported language choices and reject same-language pairs for dedicated translation. Preserve dashscope/openai IDs and migrate no other provider's credentials. All credential fields use the existing Android Keystore-backed encrypted preferences.

The six additional adapters mirror desktop protocol encoders and event semantics. Keep framing bounded, ignore output audio, cap incoming messages/transcript accumulation, stop promptly, discard late events, and keep errors/logs free of provider-controlled text and credentials. Authentication differs by provider: API key headers/query, Azure resource deployments, Tencent signed URL, Baidu startup credentials and Volcano binary protobuf frames. No new service, microphone capture, automatic profile fallback or content persistence is introduced.

## Verification and delivery

Test catalog normalization, credential isolation/validation, signed requests, exact protocol frames, readiness, event ordering, final/draft behavior and teardown without real credentials. Run Android unit tests/lint/build, update UI smoke coverage and inspect light/dark, missing/configured/error and long-field screens in the emulator. Re-run actual Firefox system-audio translation using the existing Alibaba key. Label every other provider as integration-tested rather than live-verified unless suitable credentials are available. Run the canonical repository check before committing. Preserve the requested 4x demo; refresh the service demo and website only after the new UI is verified.

## Verified scope

The Android build, 33 unit tests and lint completed successfully (zero lint errors; 11 advisory warnings). The canonical repository check passed, including 437 Rust tests and 120 frontend tests. Both light and dark instrumented UI checks passed across all eight editors, empty/unsaved secret fields, language Undo, appearance persistence, history clearing and keyboard placement. An installed build captured Firefox playback in the Android 15 emulator and displayed real Alibaba Cloud English/Chinese subtitles; stopping cleared the system projection. Other providers remain protocol-tested only; no physical-device acceptance is claimed.
