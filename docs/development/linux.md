# Linux

Mimi's Linux packages target x86_64, built on Ubuntu 22.04. Use a desktop
session with PulseAudio or PipeWire's PulseAudio compatibility server
(`pipewire-pulse`) and a working default playback device. API keys use the
desktop's Secret Service (such as GNOME Keyring); unlock its login collection
before saving credentials. There is no file or environment-variable fallback.

## Install and update

Download the `.deb` or `.AppImage` from [Releases](https://github.com/yuxino/mimi/releases/latest).

- Ubuntu/Debian: install the downloaded `.deb` with the system package
  installer, or `sudo apt install ./mimi_<version>_amd64.deb`.
- AppImage: make the downloaded file executable and open it. Older FUSE-based
  AppImage launchers need FUSE 2 support (`libfuse2` on Ubuntu 22.04).
- AppImage supports signed updates in Settings. Quit before updating `.deb`
  with a newer package; its Settings button opens Releases.

Mimi opens Settings at startup, so a tray extension is optional. Minimize
Settings to keep subtitles running; closing Settings exits Mimi on Linux. X11 is
recommended for the complete overlay experience. Wayland window placement,
always-on-top, click-through, and global shortcuts depend on the compositor;
use Settings controls when shortcuts are unavailable. No Linux ARM64 package
is currently produced.

## Audio and troubleshooting

Only the current default output's monitor is opened. Mimi verifies the source
belongs to that output and never falls back to a microphone or default input.
The output is fixed for a capture session; restart the session after changing
speakers or headphones. A missing monitor or disconnected sound server is an
error, not permission to record another source.

If capture fails, check that the sound server is running and that normal apps
can play through the default output. If credentials are unavailable, check
that a Secret Service provider is running on your desktop D-Bus session and
its collection is unlocked. Do not paste keys into environment variables.

## Build and verification

Install Rust 1.88+, Node.js 22.13+, and the native dependencies listed by
`scripts/linux-ci-deps.sh` (Ubuntu). Then:

```bash
npm ci
./scripts/check.sh
npm run tauri -- build --config src-tauri/tauri.ci.conf.json -- --locked
```

The CI config disables updater signing for development bundles. Formal release
builds use the existing signing key and verify the AppImage signature before
publishing. CI also exercises generated audio through an isolated null output,
an isolated Secret Service round trip, and three independent credential-free
Xvfb launches of each installed package format. Any failed launch stops the
check; it is not retried into a passing result.

Native validation also runs in an isolated Ubuntu 22.04.5 ARM64 virtual machine:
PulseAudio 15 and PipeWire 0.3.48 with WirePlumber 0.4.8 both capture a generated
997 Hz tone through the selected output monitor at 16/24 kHz, including
stop/restart with an unrelated default input. GNOME Keyring exercises real
save/read/update/delete operations with a synthetic credential. Locally built
ARM64 `.deb` and AppImage packages are for this validation only; the public
release target remains x86_64.

The VM's Openbox X11 desktop uses a compositor for transparent windows. It
also checks normal installed-app startup, language switching, privacy
defaults, and the `.deb` update entry. Xlib threading is initialized before
GTK starts, avoiding an intermittent native startup abort found by this test.
An installed production-mode build also connected to Alibaba Cloud using an
isolated Secret Service credential, captured generated English speech from
the system output, and displayed Chinese translations. This is a functional
check, not a provider latency benchmark. Physical Linux audio hardware, public
x86_64 artifacts, and other GNOME/KDE/Wayland compositors remain separate
acceptance checks.
