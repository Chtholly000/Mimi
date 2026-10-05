#!/bin/sh
set -eu
umask 077
tool_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cache_dir="$HOME/.local/share/mimi-local-models/qwen-asr"
command -v uv >/dev/null 2>&1 || { echo 'Install uv first, then rerun this script.' >&2; exit 1; }
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo 'Apple Silicon macOS is required.' >&2; exit 1; }
mkdir -p "$cache_dir"
chmod 700 "$cache_dir"
if [ ! -x "$cache_dir/venv/bin/python" ]; then
  uv venv --python 3.12 "$cache_dir/venv"
fi
uv pip sync --python "$cache_dir/venv/bin/python" --require-hashes "$tool_dir/requirements.lock"
"$cache_dir/venv/bin/python" "$tool_dir/prepare.py" --cache "$cache_dir"
