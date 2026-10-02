# Optional microphone input — issue #100, first phase

## Scope

Desktop Mimi can use either system output or the default microphone as the
single input to the existing recognition and translation pipeline. System
output remains the default for fresh installs and existing preferences. There
is no mixing, simultaneous capture, or Remote / Me speaker labeling in this
phase. Android capture is unchanged. Issue #100 explicitly permits this first
phase; dual independent recognition sessions remain future work.

## Selection and lifecycle

The Settings audio input choice is global, separate from service profiles and
recognition/translation language choices. Windows output selection applies only
to system audio. Selecting microphone alone does not request permission or
open a device. Explicitly starting subtitles opens the selected source; a
microphone start on macOS requests microphone permission without screen/audio
capture permission. The development and production bundles both declare
`NSMicrophoneUsageDescription` and the
[audio-input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input).

Snapshot the input at manual start. Pause stops capture; resume, reconnect and
recovery retain that input. Changing inputs requires stopping the session,
including connecting, paused and recovery states. Startup cancellation must
invalidate native workers before a delayed permission result can open capture.
A missing or denied source fails visibly, without falling back to another
input. Default microphone selection is resolved at each start; switching input
devices during a session is not offered in this phase.

## Capture and data

macOS and Windows reuse the repository's patched CPAL dependency for default
input capture. CPAL is newly enabled on macOS; no second audio framework or
resampler dependency is introduced. Audio is downmixed and resampled through
the existing bounded PCM pipeline at the provider's required 16/24 kHz rate.
Linux uses the existing PulseAudio/PipeWire-Pulse worker and verifies that the
selected default input is not an output monitor. System capture continues to
resolve only output monitors. Native handles stay on their capture worker.

Recording and subtitle retention remain off by default. A change of audio
input clears the recording opt-in, including a combined draft that attempts to
switch source and enable recording. The user can enable recording again for
the selected source. Current-session audio is cleared by the existing opt-out
path; explicitly saved history is retained. Recording still writes bounded
private local session files; diagnostic output contains no device names,
audio, or recognized/translated text. Microphone capture status identifies its
input rather than displaying playback-device information or system-audio
troubleshooting advice. UI-only tests never access any capture backend.

## Interface and verification

Use one normal-size selector with System audio / Microphone choices. Put
non-essential scope, device and permission help in hover/focus tooltips, not
persistent small print. Keep independent speech and text translation setup.

Verify preference migration and round trips; settings-window restrictions;
active-session source locking; recording consent reset; mono/resampling;
startup cancellation and worker release; Linux monitor rejection; localized
source/permission/error presentation; and production/development permission
metadata. Run `scripts/check.sh`, signed macOS UI-only smoke, and native-platform
PR CI. Record actual hardware/provider verification separately from fixtures.
This change is submitted as a PR for review, without merge or release.
