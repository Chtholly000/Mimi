#!/bin/sh
set -eu
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$root_dir/venv/bin/python3" "$root_dir/status.py" "${1:-status}"
