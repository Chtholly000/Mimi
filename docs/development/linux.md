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

Mimi opens Settings at startup, so a tray extension is optional. X11 is
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
an isolated Secret Service round trip, and a credential-free Xvfb UI launch.
These checks do not prove a real provider translation session or every
GNOME/KDE/Wayland desktop. Physical Linux audio, provider latency, and compositor
behavior remain separate acceptance checks.
