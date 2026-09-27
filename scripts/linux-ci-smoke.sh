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
export MIMI_UI_TEST_FRONTEND_READY_DIR="$smoke_dir/frontend-ready"

openbox >"$smoke_dir/openbox.log" 2>&1 &
wm_pid=$!
wm_ready=0
for _ in {1..40}; do
  if ! kill -0 "$wm_pid" 2>/dev/null; then
    cat "$smoke_dir/openbox.log" >&2
    exit 1
  fi
  if wmctrl -m >/dev/null 2>&1; then wm_ready=1; break; fi
  sleep 0.25
done
[[ "$wm_ready" == 1 ]] || { echo "Openbox did not become ready." >&2; exit 1; }
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
    && [[ -f "$MIMI_UI_TEST_FRONTEND_READY_DIR/settings" ]] \
    && [[ -f "$MIMI_UI_TEST_FRONTEND_READY_DIR/overlay" ]] \
    && xdotool search --onlyvisible --name '^mimi UI test settings$' >/dev/null \
    && xdotool search --onlyvisible --name '^mimi Subtitles$' >/dev/null; then
    ready=1
    break
  fi
  sleep 0.5
done
if [[ "$ready" != 1 ]]; then
  echo "mimi did not render settings and subtitle frontends with a listening UI-test session." >&2
  cat "$smoke_dir/app.log" >&2
  exit 1
fi
echo "Linux UI smoke passed: both frontends rendered; windows visible; synthetic session listening."

# Verify native attachment as well as rendering: no invisible click-catching
# area below the island, and no control window stranded at the desktop origin.
overlay_window="$(xdotool search --onlyvisible --name '^mimi Subtitles$' | head -1)"
control_window=""
for _ in {1..20}; do
  control_window="$(xdotool search --onlyvisible --name '^mimi$' | head -1 || true)"
  [[ -n "$control_window" ]] && break
  sleep 0.25
done
[[ -n "$control_window" ]] || { echo "Overlay control was not mapped." >&2; exit 1; }
window_geometry() {
  xwininfo -id "$1" | awk '
    /Absolute upper-left X:/ { x=$4 }
    /Absolute upper-left Y:/ { y=$4 }
    /Width:/ { w=$2 }
    /Height:/ { h=$2 }
    END { print x, y, w, h }'
}
window_is_visible() {
  xwininfo -id "$1" | grep -q 'Map State: IsViewable'
}
assert_control_attached() {
  local ox oy ow oh cx cy cw ch
  for _ in {1..20}; do
    read -r ox oy ow oh < <(window_geometry "$overlay_window")
    read -r cx cy cw ch < <(window_geometry "$control_window")
    if [[ "$cx" == "$((ox + 18))" && "$cy" == "$((oy + 16))" \
      && "$cw" == 236 && "$ch" == 30 \
      && ( -z "${1:-}" || ( "$ox" == "$1" && "$oy" == "$2" ) ) ]] \
      && window_is_visible "$overlay_window" && window_is_visible "$control_window"; then return; fi
    sleep 0.25
  done
  echo "Overlay control geometry failed: parent=$ox,$oy,$ow,$oh control=$cx,$cy,$cw,$ch" >&2
  exit 1
}
assert_control_attached
wmctrl -ir "$overlay_window" -e 0,120,140,-1,-1
assert_control_attached 120 140
echo "Linux overlay geometry passed: initial attachment, exact island bounds, native move following."

# Leave a geometry debounce pending, then stop before it fires. Neither that
# callback nor a later mapping event may resurrect a stopped control window.
wmctrl -ir "$overlay_window" -e 0,160,160,-1,-1
xdotool key --clearmodifiers ctrl+shift+space
for _ in {1..40}; do
  [[ "$(cat "$MIMI_UI_TEST_SESSION_STATE_FILE")" == idle ]] && break
  sleep 0.05
done
[[ "$(cat "$MIMI_UI_TEST_SESSION_STATE_FILE")" == idle ]] || {
  echo "Linux session shortcut did not stop the UI-test session." >&2; exit 1;
}
sleep 0.75
if xdotool search --onlyvisible --name '^mimi$' >/dev/null; then
  echo "A stopped overlay control became visible again." >&2; exit 1
fi
xdotool key --clearmodifiers ctrl+shift+space
for _ in {1..40}; do
  [[ "$(cat "$MIMI_UI_TEST_SESSION_STATE_FILE")" == listening ]] && break
  sleep 0.05
done
[[ "$(cat "$MIMI_UI_TEST_SESSION_STATE_FILE")" == listening ]] || {
  echo "Linux session shortcut did not restart the UI-test session." >&2; exit 1;
}
assert_control_attached
echo "Linux overlay lifecycle passed: move-stop stays hidden; restart reattaches."

# A desktop without a tray must still have a reliable exit path. Closing
# Settings exits on Linux; minimizing it is the keep-running action.
settings_window="$(xdotool search --onlyvisible --name '^mimi UI test settings$' | head -1)"
# Send the window manager's normal close request to Settings directly. An
# Alt+F4 keypress can reach the overlay if startup changes focus concurrently.
# Do not use XDestroyWindow: it bypasses the app's CloseRequested handler.
xprop -id "$settings_window" WM_PROTOCOLS | grep -q WM_DELETE_WINDOW
wmctrl -ic "$settings_window"
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
cat "$smoke_dir/app.log" "$smoke_dir/openbox.log" >&2
wmctrl -l >&2 || true
xprop -root _NET_ACTIVE_WINDOW >&2 || true
exit 1
