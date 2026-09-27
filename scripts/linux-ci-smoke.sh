#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || $# -ne 1 ]]; then
  echo "usage (Linux): $0 <mimi-executable-or-AppImage>" >&2
  exit 2
fi
executable="$(realpath "$1")"
[[ -x "$executable" ]] || { echo "Executable not found: $executable" >&2; exit 1; }

# Each invocation gets its own display, session bus, and profile directories.
# UI-test mode exercises only synthetic local session state; it never reads
# credentials, contacts a provider, or opens system-audio capture.
if [[ "${MIMI_LINUX_SMOKE_SESSION:-}" != 1 ]]; then
  exec dbus-run-session -- xvfb-run -a env MIMI_LINUX_SMOKE_SESSION=1 "$0" "$executable"
fi

smoke_dir="$(mktemp -d -t mimi-linux-smoke.XXXXXX)"
app_pid=""
wm_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ -n "$wm_pid" ]]; then
    kill "$wm_pid" 2>/dev/null || true
    wait "$wm_pid" 2>/dev/null || true
  fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT
export XDG_CONFIG_HOME="$smoke_dir/config"
export XDG_DATA_HOME="$smoke_dir/data"
export XDG_CACHE_HOME="$smoke_dir/cache"
export XDG_RUNTIME_DIR="$smoke_dir/runtime"
mkdir -m 700 -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
export GDK_BACKEND=x11
export LIBGL_ALWAYS_SOFTWARE=1
export MIMI_UI_TEST=1
export MIMI_UI_TEST_STANDARD_OVERLAY=1
export MIMI_AUTO_START=1
export MIMI_UI_TEST_SESSION_STATE_FILE="$smoke_dir/session-state"

openbox >"$smoke_dir/openbox.log" 2>&1 &
wm_pid=$!
if [[ "$executable" == *.AppImage ]]; then
  # Hosted CI may not expose /dev/fuse. This still executes the packaged
  # AppRun and bundled libraries instead of the loose build executable.
  "$executable" --appimage-extract-and-run >"$smoke_dir/app.log" 2>&1 &
else
  "$executable" >"$smoke_dir/app.log" 2>&1 &
fi
app_pid=$!

ready=0
for _ in {1..60}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "mimi exited before the Linux UI smoke test completed." >&2
    cat "$smoke_dir/app.log" >&2
    exit 1
  fi
  if [[ -f "$MIMI_UI_TEST_SESSION_STATE_FILE" ]] \
    && [[ "$(cat "$MIMI_UI_TEST_SESSION_STATE_FILE")" == listening ]] \
    && xdotool search --onlyvisible --name '^mimi UI test settings$' >/dev/null \
    && xdotool search --onlyvisible --name '^mimi Subtitles$' >/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != 1 ]]; then
  echo "mimi did not show settings and subtitle windows with a listening UI-test session." >&2
  cat "$smoke_dir/app.log" >&2
  exit 1
fi
echo "Linux UI smoke passed: settings and subtitle windows visible; synthetic session listening."

# A desktop without a tray must still have a reliable exit path. Closing
# Settings exits on Linux; minimizing it is the keep-running action.
settings_window="$(xdotool search --onlyvisible --name '^mimi UI test settings$' | head -1)"
xdotool windowactivate --sync "$settings_window" key --clearmodifiers alt+F4
for _ in {1..20}; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid"
    app_pid=""
    echo "Linux close-to-exit smoke passed."
    exit 0
  fi
  sleep 0.25
done
echo "Closing Linux Settings did not exit Mimi." >&2
exit 1
