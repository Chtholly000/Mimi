#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  echo "This test requires Linux and PulseAudio." >&2
  exit 2
fi
audio_dir="$(mktemp -d -t mimi-linux-audio.XXXXXX)"
pulse_pid=""
cleanup() {
  if [[ -n "$pulse_pid" ]]; then
    kill "$pulse_pid" 2>/dev/null || true
    wait "$pulse_pid" 2>/dev/null || true
  fi
  rm -rf "$audio_dir"
}
trap cleanup EXIT
export PULSE_SERVER="unix:$audio_dir/pulse.sock"
export PULSE_RUNTIME_PATH="$audio_dir/runtime"
mkdir -m 700 "$PULSE_RUNTIME_PATH"
# Deliberately make the default source unrelated to the default output. The
# test must capture mimi-output.monitor, never the microphone/default source.
pulseaudio --daemonize=no --exit-idle-time=-1 --use-pid-file=no -n \
  --load="module-native-protocol-unix socket=$audio_dir/pulse.sock auth-anonymous=1" \
  --load="module-null-sink sink_name=mimi-output" \
  --load="module-null-sink sink_name=mimi-microphone" \
  --log-target="file:$audio_dir/pulse.log" &
pulse_pid=$!
ready=0
for _ in {1..40}; do
  if pactl info >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" != 1 ]]; then
  cat "$audio_dir/pulse.log" >&2
  exit 1
fi
pactl set-default-sink mimi-output
pactl set-default-source mimi-microphone.monitor
timeout 120s cargo test --locked --manifest-path src-tauri/Cargo.toml \
  native_monitor_capture_is_pcm16_and_restarts -- --ignored --nocapture
