# Windows sound source

Windows can route Teams or another app to headphones while the default output is speakers. A mismatch can explain missing input, but does not establish the cause of a provider `task-failed` response. This change offers output selection and a content-free sound indicator; it does not claim to fix Teams or provider failures.

## Behavior

- One row in subtitle settings, Windows only. Follow system is the default; manual choices are active render endpoints, identified with CPAL/WASAPI stable device IDs rather than names or enumeration positions. No microphone capture, drivers, installs, or shell commands.
- Follow system polls the default render endpoint every second during capture. A changed ID drops the old stream and creates a fresh resampler and loopback stream using the same bounded send pipeline. There may be a short gap during rebinding. This is live following, not a start-only preference.
- A manual source stays pinned. Missing saved selections and disconnected devices never silently fall back to another output. Settings retain the choice and show an unavailable option with instructions to select another source. Native failures use the existing generation-scoped teardown/recovery path.
- Changing the preference requires an inactive session. The backend enforces this with the existing lifecycle/settings guard, including connecting and paused sessions. Stop, choose, then start; provider sockets and capture are never restarted by a settings save.
- A control mutex serializes native install, monitor rebind, and stop. Stop increments the monitor generation before dropping the stream; a retired monitor cannot reopen capture after stop or act on a later session.
- The sound indicator retains only the timestamp of the most recent finite sample above 0.001 amplitude. It expires after two seconds. It means sound was received, not speech recognized or translation succeeded. No raw audio, subtitles, or keys are added to storage or logs. Existing explicitly enabled recording remains unchanged.
- Device lists and activity refresh while settings are open. Chinese, English, and Japanese convey the same instructions and states. macOS/Linux return no Windows source snapshot and retain their existing capture behavior.

## Verification boundaries

Pure policy tests cover default changes, stable endpoints, missing selections, and retired monitor generations. Native Windows tests cover sample activity and existing stream start/stop race handling. The canonical local check verifies macOS Rust and frontend compatibility. Windows CI compiles and tests the actual WASAPI branch on x64 and ARM64 where configured.

CI and policy tests do not prove physical headphones, default-device changes, unplug/replug behavior, or Teams routing. Windows hardware acceptance still requires: start with speakers; change default to headphones while listening; choose the actual Teams output after stopping; unplug a pinned device; reconnect it; reopen settings with an unavailable saved choice; verify silence/playing/paused states. No merge or release is authorized by this draft PR.

The concurrent DeepLX work is independent. Shared preference, IPC, settings view, and type files may need conflict resolution when separately reviewed; this branch does not include or merge that work.
