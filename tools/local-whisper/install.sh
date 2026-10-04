#!/bin/sh
set -eu
umask 077
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'This installer requires an Apple Silicon Mac.' >&2
  exit 1
fi
command -v uv >/dev/null
command -v cmake >/dev/null
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install_dir="$HOME/.local/share/mimi-local-models/whisper"
mkdir -p "$install_dir"
chmod 700 "$install_dir"
if launchctl print "gui/$(id -u)/local.mimi-whisper" >/dev/null 2>&1; then
  echo 'Stop the existing Whisper service before installing.' >&2
  exit 1
fi
uv venv --python 3.12 --allow-existing "$install_dir/venv"
uv pip install --python "$install_dir/venv/bin/python3" -r "$source_dir/requirements.txt"
exec "$install_dir/venv/bin/python3" "$source_dir/install.py"
