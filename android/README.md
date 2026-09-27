# mimi for Android

Native Android development port of [mimi](../README.md) — live subtitles and
translation for system audio. Pure Kotlin (no Tauri), single module.

> This port is not part of the official mimi desktop releases. It reads the
> same provider wire protocols as the desktop app (`src-tauri/src/core/protocols`)
> with provider-specific credentials configured on Android. Live verification is
> listed below; protocol parity alone does not establish service availability.

## Features

- **System-audio capture** — `MediaProjection` + `AudioPlaybackCapture`
  (API 29+). Requires Android’s `RECORD_AUDIO` runtime grant for playback capture;
  never uses a microphone source. Captures what other apps play
  (`USAGE_MEDIA/GAME/UNKNOWN`), 48 kHz stereo float, box-filter downmix +
  resample to the provider's target rate (16 kHz / 24 kHz mono PCM16).
- **Services** — Alibaba Cloud DashScope, OpenAI Realtime Translation, Google Gemini Live,
  Azure OpenAI, Volcano Engine Doubao, Tencent Cloud, Baidu realtime translation and xAI Grok Voice.
  Their wire contracts mirror the corresponding desktop adapters. Grok is turn-based voice translation;
  generated audio is discarded. Each service has its own encrypted credential fields and supported language choices.
- **Configuration** — tap a configured service to switch, or open its settings to edit. Azure requires a
  resource endpoint and translation/transcription deployment names; Tencent requires AppID, SecretID and
  SecretKey; Baidu requires AppID and AppKey. Other services use an API key. Optional endpoint/model overrides
  are available for DashScope, OpenAI, Gemini and xAI. Stored secrets are not filled back into the editor;
  leaving a secret field empty preserves its saved value. Changes are written only with Save and use.
- **Subtitle overlay** — `TYPE_APPLICATION_OVERLAY` floating window, text-hugging
  card, always horizontally centered over the video, vertically draggable
  (position persists). Background alpha adjustable 0–90 % (0 = plain text over
  video, like embedded subtitles), text color presets, font size, whole-window
  opacity.
- **Native-subtitle behaviour** — only the current sentence is shown (drafts
  are clipped to the last sentence of the provider's cumulative buffer);
  English source speech shows source + translation lines, other languages show
  the translation only; the card hides shortly after speech ends and never
  lingers (streaming-watchdog fallback for cases where provider VAD is held
  open by background music).
- **Hotwords** — DashScope `translation.corpus.phrases` via comma-separated
  `source=translation` entries (for example, `Cyberpunk=赛博朋克`).
- **Credentials** — EncryptedSharedPreferences (Android Keystore master key),
  scoped by provider.
- **History privacy** — disabled by default; opting into history retains only a bounded
  in-memory list. Disabling it or stopping the session clears retained subtitles.

## Requirements

- Android 10+ (API 29); the original contributor reported Android 17 testing,
  and the updated interface is checked on an Android 15 emulator
- Credentials for one supported service (usage may incur provider charges)
- The "Display over other apps" and `RECORD_AUDIO` grants, plus per-start MediaProjection consent

## Build

```sh
export ANDROID_HOME=/path/to/android-sdk
./gradlew testDebugUnitTest lintDebug assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Requires JDK 17, Android SDK platform 35 and build-tools 35.0.0. The wrapper pins
Gradle 8.10.2 and verifies its distribution checksum. minSdk 29, targetSdk 35,
Kotlin 2.0, AGP 8.7. CI builds a debug APK and runs tests/lint; device capture is
a separate manual check.

## Local UI preview

The Android interface reuses Mimi's existing character artwork and neutral
light/dark palette. Languages can be changed directly on the home screen with Undo. Tapping the
subtitle sample opens appearance settings, where changes are saved automatically
and previewed without capture or a network session. The service tab lists all eight integrations and opens a separate editor with only that service’s fields.
Credentials require explicit Save and use; changing appearance never saves credentials. Your own service credentials are still required for real translation.

On a development emulator with no active subtitle session:

```sh
./gradlew assembleDebug assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e theme light app.yuxino.mimi.android.test/app.yuxino.mimi.android.UiSmokeInstrumentation
adb shell am instrument -w -e theme dark app.yuxino.mimi.android.test/app.yuxino.mimi.android.UiSmokeInstrumentation
```

The checks exercise quick language selection/Undo, direct appearance access,
auto-save with actual touch gestures, all eight service editors, write-only secret fields, rejected incomplete configurations, history clearing and the
keyboard. Changed non-secret preferences are restored in a finally block; provider
drafts are discarded without Save and use. No provider or audio capture session starts. Screenshots contain sample subtitles and empty key
fields and are written to the app's external `files/ui-preview` directory. Pass
`-e demo true` for a paced walkthrough suitable for emulator screen recording;
it demonstrates the labeled sample, not live translation.

## Architecture

```
app/src/main/java/app/yuxino/mimi/android/
  MainActivity.kt            start flow, overlay-permission gate, projection consent
  SettingsActivity.kt        service list and appearance settings
  ServiceSettingsActivity.kt provider-specific write-only credential editor
  ServiceSettingsUi.kt       compact service picker
  SettingsStore.kt           EncryptedSharedPreferences-backed settings
  capture/MimiService.kt     foreground service (mediaProjection type):
                             capture loop + overlay window + auto-hide timers
  resample/StreamResampler.kt  O(1) box-filter downmix + resample to PCM16 mono
  provider/ServiceCatalog.kt  service fields, capabilities and language normalization
  provider/StreamingServiceEngine.kt bounded transport for additional services
  provider/CloudProtocols.kt Gemini, Azure, Tencent and Baidu wire adapters
  provider/VolcanoProtocol.kt Doubao binary protobuf adapter
  provider/GrokProtocol.kt    xAI turn-based transcript adapter
  provider/ProviderEngine.kt   engine interface + WS URL normalization
  provider/DashScopeEngine.kt  qwen3.5-livetranslate realtime WS client
  provider/OpenAIRealtimeEngine.kt  gpt-realtime-translate WS client
  provider/SubtitleBus.kt      shared subtitle state, sentence clipping, pairing
```

## Verification status

The updated interface and Alibaba Cloud system-playback translation have been exercised in an Android 15
emulator with Firefox. The bundled Chrome tested there explicitly disables playback capture and yields silent
samples; this finding is specific to that browser package. The additional provider adapters have protocol tests,
including Tencent signing and Volcano binary frames, but have not been verified against live accounts. Do not
interpret build or protocol-test success as physical-device or all-provider acceptance. The original contributor’s
reported device test applies to the original port, not every subsequent change.

## Known limits

- MediaProjection requires user consent on every start (platform rule).
- DRM-protected output and apps that disallow playback capture cannot be captured.
- Provider VAD can hold sentences open when background music is continuous;
  the overlay uses a streaming-gap watchdog so subtitles still hide.
- OpenAI uses punctuation-based source/translation pairing; it does not yet reproduce
  the desktop timestamp alignment and may pair differently segmented sentences.
- DashScope sentence finals depend on server-side VAD; continuous speech with
  music may deliver whole-utterance finals — handled by sentence clipping.

MIT, same as upstream. Port authored independently; upstream code was used as
a wire-protocol reference only.
