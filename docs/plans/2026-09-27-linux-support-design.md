# Linux desktop support

## Scope

Add x86_64 Linux packages built on Ubuntu 22.04, retaining the same providers,
bounded PCM pipeline, overlay, opt-in export controls, and credential privacy.
Ship `.deb` and AppImage; keep the website in its separate repository.

## Capture

Use `libpulse-binding` only on Linux. PulseAudio's native API also works with
PipeWire's PulseAudio compatibility server. Direct ALSA capture lacks a reliable
system-output monitor; a `parec` child process adds an external CLI dependency
and complicates lifecycle handling. The native asynchronous API allows bounded
startup and cancellation without a blocking read that can strand shutdown.

One worker owns the PulseAudio context, stream, and mainloop. Resolve the
default sink and verify its monitor belongs to that sink before connecting.
Never connect to an unspecified/default recording source. The server converts
to provider PCM16LE mono at 16 or 24 kHz. Capture remains pinned to that output;
users restart after changing devices. Pause stops capture and resume starts a fresh worker; stop cancels the
worker, and fatal errors use the existing sanitized capture-failure channel.

## Credentials and desktop

Initialize Xlib threading before Tauri/GTK opens its first display. Reuse Tao's
already-locked `x11-dl` version as a direct Linux dependency for that early call;
it does not open a display or select X11 over Wayland. Ubuntu 22.04 native UI
stress tests reproduced XCB sequence corruption when initialization happened
too late, and the early call must be verified without preload diagnostics.

The existing keyring v4 compatibility API selects Secret Service on Linux.
Keep that secure backend and existing profile-scoped entries; fail closed when
unavailable. No plaintext fallback or microphone capture is added. Retention
and recording stay off by default.

Use a colored tray asset outside macOS. Settings remains accessible at startup
when the desktop has no tray host. Linux closes to exit rather than hiding an
unreachable process; minimize Settings to keep subtitles running. Recommend X11; document compositor limits
for positioning, always-on-top, click-through, and global shortcuts on Wayland.

## Linux presentation

Prefer a consistent installed Noto/desktop UI font across WebKitGTK text and
form controls. Allow full language labels and credential state to wrap within
the default Settings width. Use a darker subtitle card and clearer empty-state
text on Linux while preserving the existing appearance on other platforms.

## Distribution and proof

Use a Linux Tauri config with explicit package dependencies. AppImage updates
use the existing signed manifest; non-AppImage Linux copies open Releases for
package updates. Preserve macOS identity/source verification and Windows ZIP
behavior. Release publishing requires Linux assets and signatures as well as
the existing platforms.

Run strict Rust/frontend checks on all platforms, an isolated PulseAudio test
with generated PCM, an isolated Secret Service test with non-secret fixtures,
package inspection, and a credential-free Xvfb native launch. State physical
Linux and real-provider acceptance separately from these automated checks.
Native smoke requires both lazy-loaded frontends to commit and paint with the
listening snapshot before recording separate, content-free readiness markers.
The marker IPC does nothing outside explicit UI-test mode and accepts no path
or content from the frontend. Publishing also waits for Windows ARM64 checks.
