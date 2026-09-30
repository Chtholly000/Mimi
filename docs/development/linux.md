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
always-on-top, and click-through depend on the compositor. On Wayland,
configure system keyboard shortcuts as described below or use Settings controls. No Linux ARM64 package
is currently produced.

## Keyboard shortcuts

On X11, Mimi registers Ctrl+Shift+Space (start/stop), Ctrl+Shift+M (Immersive
Mode), and Ctrl+Shift+B (subtitle display). On Wayland, assign commands in
your desktop's keyboard settings. Mimi does not install desktop bindings or
claim that an XWayland key grab is a working Wayland shortcut.

For a `.deb` installation:

| Action | Command |
| --- | --- |
| Start or stop subtitles | `mimi --toggle-session` |
| Toggle Immersive Mode | `mimi --toggle-immersive` |
| Cycle translation, bilingual, and original subtitles | `mimi --cycle-subtitle-display` |

On GNOME, open Settings → Keyboard → View and Customize Shortcuts → Custom
Shortcuts. Add an entry, paste the command, and choose an available key
combination. Mimi's Settings shows commands for the current installation.
AppImage users must use the quoted absolute AppImage path instead of `mimi`;
update the binding after moving or renaming the AppImage.

A command controls the running Mimi instance. When Mimi is closed, it opens
Mimi and performs the action; starting subtitles still requires a configured
service. Normal repeated launches bring the existing Settings window forward.
Desktop commands are debounced, and start/stop is ignored while connecting or
stopping, just like the native session shortcut.

Installed `.deb` and AppImage CI tests verify command forwarding, start/stop,
Immersive Mode, and absence of duplicate Settings windows under Xvfb. This
checks the command path, not GNOME/KDE shortcut setup or native Wayland focus.

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
./scripts/build-linux-packages.sh --config src-tauri/tauri.ci.conf.json
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

### AppImage launcher permissions

Use `scripts/build-linux-packages.sh` for x86_64 Linux packages, including
signed release builds. It prepares Tauri's upstream AppRun cache with mode
755 before bundling and updater signing. Tauri otherwise creates it as 770;
linuxdeploy preserves that mode as `AppRun.wrapped`, blocking execution by
users outside the build owner's UID/group (reported in #66).
`verify-linux-bundles.sh` extracts the final AppImage and checks read/execute
bits for owner, group, and other on both launchers and `usr/bin/mimi` before
running the existing tray-free X11 smoke tests. FUSE availability, runtime
library dependencies, and glibc compatibility remain separate checks.
