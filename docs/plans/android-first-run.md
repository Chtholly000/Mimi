# Android first-run guide (#82)

Stacked on capture-health #76 (`2471629`). Only Android code is changed.

Five short, reopenable bottom-sheet pages guide service choice, locally saved
credentials, overlay/playback permissions, actual audio and a rendered caption.
Saving never invokes a provider. Permission inspection never starts a paid session;
only the explicit trial action requests per-session MediaProjection and connects.
Skip dismisses the guide without completing it. Returning rechecks permissions and
current-session observations. Historical completion does not substitute for new proof.

Completion requires nonzero PCM passed to the selected provider and a nonempty
translation drawn by the real overlay in the same capture generation. Preview and
hidden text never count. Stop clears session evidence. No text or keys are retained
in evidence. Existing mimi brand image remains a replacement slot for approved poses;
unconfirmed character sheet is not shipped.

Help links reuse desktop's eight-provider public official research (2026-09-30),
placed beside credentials. No bypass of DRM, source opt-out or voice-call policy.

Verification uses synthetic configuration and emulator UI; it does not claim a live
provider caption or real Android 10/14/15 Bluetooth capture.

## Recovery and verification

An existing encrypted settings file is detected before settings initialization,
so upgrades do not force the first-run dialog even without a saved provider key.
Rotation restores the selected provider and page; every restore reads live grants.
Encrypted storage errors remain local, show a retry hint and never fall back to
plaintext. Permission inspection is guarded against repeated taps. Screen-off,
lock and permission revocation stop the capture session.

Android verification: debug/release unit tests (39 each), lint, both APK variants
and instrumentation APK. The API 35 Pixel 7 emulator uses only a synthetic key
that is never sent. The first-run instrumentation visits actual overlay and audio
permission requests, declines them, grants via test shell commands, revokes the
overlay grant, cancels real MediaProjection consent, checks keyboard focus and
checks upgrade suppression. App data is cleared between runs. This proves native
UI recovery, not a real provider session. Positive caption completion is covered
by the isolated evidence model; no live provider-caption claim is made. Real
Android 10/14/15 devices, Bluetooth and actual provider authentication are untested.
