# mimi for Android

Unofficial native Android port of [mimi](../README.md) — live subtitles and
translation for system audio. Pure Kotlin (no Tauri), single module.

> This port is not part of the official mimi desktop releases. It reads the
> same provider wire protocols as the desktop app (`src-tauri/src/core/protocols`)
> so the same API credentials work identically.

## Features

- **System-audio capture** — `MediaProjection` + `AudioPlaybackCapture`
  (API 29+). No microphone permission; captures what other apps play
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
  `term=weight` entries.
- **Credentials** — EncryptedSharedPreferences (Android Keystore master key).

## Requirements

- Android 10+ (API 29), tested on Android 17
- A provider API key (DashScope / OpenAI compatible)
- The "Display over other apps" grant, plus the per-start MediaProjection consent

## Build

```sh
export ANDROID_HOME=/path/to/android-sdk
gradle assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

minSdk 29, targetSdk 35, Kotlin 2.0, AGP 8.7.

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
- DRM-protected output is not capturable (no subtitles for those streams).
- Provider VAD can hold sentences open when background music is continuous;
  the overlay uses a streaming-gap watchdog so subtitles still hide.
- DashScope sentence finals depend on server-side VAD; continuous speech with
  music may deliver whole-utterance finals — handled by sentence clipping.

MIT, same as upstream. Port authored independently; upstream code was used as
a wire-protocol reference only.
