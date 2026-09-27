# mimi for Android

Unofficial native Android port of [mimi](../README.md) — live subtitles and
translation for system audio. Pure Kotlin (no Tauri), single module.

> This port is not part of the official mimi desktop releases. It reads the
> same provider wire protocols as the desktop app (`src-tauri/src/core/protocols`)
> so the same API credentials work identically.

## Features

- **System-audio capture** — `MediaProjection` + `AudioPlaybackCapture`
  (API 29+). Requires Android’s `RECORD_AUDIO` runtime grant for playback capture;
  never uses a microphone source. Captures what other apps play
  (`USAGE_MEDIA/GAME/UNKNOWN`), 48 kHz stereo float, box-filter downmix +
  resample to the provider's target rate (16 kHz / 24 kHz mono PCM16).
- **Providers** (wire-protocol aligned with desktop mimi):
  - Aliyun DashScope `qwen3.5-livetranslate-flash-realtime` (16 kHz)
  - OpenAI Realtime `gpt-realtime-translate` (24 kHz, 200 ms frames)
  - Custom base URL (any `wss://` relay; `https://` auto-corrected) and model
    overrides per provider.
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

- Android 10+ (API 29), tested on Android 17
- A provider API key (DashScope / OpenAI compatible)
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
and previewed without capture or a network session. Credentials require explicit
Save in the service tab. A provider API key is still required for real translation.

On a development emulator with no active subtitle session:

```sh
./gradlew assembleDebug assembleDebugAndroidTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e theme light app.yuxino.mimi.android.test/app.yuxino.mimi.android.UiSmokeInstrumentation
adb shell am instrument -w -e theme dark app.yuxino.mimi.android.test/app.yuxino.mimi.android.UiSmokeInstrumentation
```

The checks exercise quick language selection/Undo, direct appearance access,
auto-save with actual touch gestures, provider drafts, history clearing and the
keyboard. Changed non-secret preferences are restored in a finally block; provider
drafts are discarded without Save. No provider or audio capture session starts. Screenshots contain sample subtitles and empty key
fields and are written to the app's external `files/ui-preview` directory. Pass
`-e demo true` for a paced walkthrough suitable for emulator screen recording;
it demonstrates the labeled sample, not live translation.

## Architecture

```
app/src/main/java/app/yuxino/mimi/android/
  MainActivity.kt            start flow, overlay-permission gate, projection consent
  SettingsActivity.kt        provider/credentials/language/appearance settings
  SettingsStore.kt           EncryptedSharedPreferences-backed settings
  capture/MimiService.kt     foreground service (mediaProjection type):
                             capture loop + overlay window + auto-hide timers
  resample/StreamResampler.kt  O(1) box-filter downmix + resample to PCM16 mono
  provider/ProviderEngine.kt   engine interface + WS URL normalization
  provider/DashScopeEngine.kt  qwen3.5-livetranslate realtime WS client
  provider/OpenAIRealtimeEngine.kt  gpt-realtime-translate WS client
  provider/SubtitleBus.kt      shared subtitle state, sentence clipping, pairing
```

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
