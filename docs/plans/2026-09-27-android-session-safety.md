# Android session safety

The Android port owns a separate Kotlin client. Keep the desktop application and
release pipeline unchanged while validating the Android module independently.

## Session ownership

Request Android's `RECORD_AUDIO` runtime grant before MediaProjection consent.
Android requires this grant for playback capture too; the only AudioRecord input
remains AudioPlaybackCaptureConfiguration, never a microphone source.

The foreground service owns capture state. Activity recreation reads that state;
duplicate starts cannot overwrite a running projection. Dispatch provider events
on the main thread with a session generation check. A stop, projection revocation,
transport failure, startup exception, or service destruction invalidates callbacks,
stops the blocking recorder before joining its worker, closes the provider, removes
the overlay and timers, and clears all subtitle state. The worker retains only its
own recorder, engine and cancellation flag so an old worker cannot feed a new session.

## Privacy and protocol

History retention is disabled by default. A positive history limit explicitly
opts into bounded in-memory pairs; zero immediately clears history and pairing
queues. New and stopped sessions clear the live text and language detection too.
Credentials stay encrypted with an Android Keystore-backed key, scoped by provider.
Migrate the old shared credential only to its original provider, before changing
provider selection. Never include arbitrary server errors or transport exceptions
in diagnostics.

DashScope corpus phrases are source-to-target translation strings, matching the
desktop wire protocol. Preserve those strings while editing settings. Bound
OpenAI's append-only preview buffer and display a trailing draft immediately after
a completed sentence in the same event. This port's punctuation-based pairing
remains approximate and is not equivalent to desktop timestamp alignment.

## Verification

Use the pinned Gradle wrapper with JDK 17, SDK 35 and build-tools 35.0.0. Android CI
runs unit tests, lint and a debug APK build independently of desktop checks. Unit
regressions cover privacy opt-in/clear/bounds, protocol fixtures, malformed events,
and streaming tails. A built APK is not proof of device capture: permission denial,
projection revocation, repeated start/stop, activity recreation, both live providers
and overlay dragging still need Android device acceptance before release.
