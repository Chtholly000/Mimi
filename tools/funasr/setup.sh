#!/usr/bin/env bash
set -euo pipefail
# Explicit dependency/model installation. Never starts inference or a service.
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo 'This recorded dependency lock is for Apple Silicon macOS.' >&2
  exit 1
fi
umask 077
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
model_root="${1:-$HOME/.local/share/mimi-local-models/funasr}"
command -v uv >/dev/null || { echo 'Install uv before running setup.' >&2; exit 1; }
mkdir -p "$model_root"
if [[ ! -x "$model_root/venv/bin/python" ]]; then
  uv venv --python 3.12.13 "$model_root/venv"
fi
uv pip sync --python "$model_root/venv/bin/python" "$script_dir/requirements-macos-arm64.lock"
uv pip check --python "$model_root/venv/bin/python"
"$model_root/venv/bin/python" "$script_dir/download.py" --root "$model_root"
