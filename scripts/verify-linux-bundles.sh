#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || $# -lt 1 || $# -gt 2 ]]; then
  echo "usage (Linux): $0 <version> [--signed]" >&2
  exit 2
fi
version="$1"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid version" >&2; exit 2; }
if [[ $# == 2 && "$2" != --signed ]]; then
  echo "Unknown option: $2" >&2
  exit 2
fi
bundle_dir=src-tauri/target/release/bundle
deb="$bundle_dir/deb/mimi_${version}_amd64.deb"
appimage="$bundle_dir/appimage/mimi_${version}_amd64.AppImage"
[[ -s "$deb" && -s "$appimage" && -x "$appimage" ]]
[[ "$(dpkg-deb --field "$deb" Package)" == mimi ]]
[[ "$(dpkg-deb --field "$deb" Version)" == "$version" ]]
[[ "$(dpkg-deb --field "$deb" Architecture)" == amd64 ]]
dpkg-deb --field "$deb" Depends | tr ',' '\n' | grep -Eq '^ *libpulse0( |$)'
file "$appimage" | grep -q 'ELF 64-bit.*x86-64'

if [[ "${2:-}" == --signed ]]; then
  [[ -s "$appimage.sig" ]]
  public_key="$(node -p 'require("./src-tauri/tauri.conf.json").plugins.updater.pubkey')"
  cargo run --release --locked --manifest-path src-tauri/Cargo.toml \
    --example verify_updater_signature -- "$public_key" "$appimage.sig" "$appimage"
fi

# Install the actual .deb and smoke both package formats independently.
sudo apt-get install --no-install-recommends -y "$(realpath "$deb")"
./scripts/linux-ci-smoke.sh /usr/bin/mimi
./scripts/linux-ci-smoke.sh "$appimage"
echo "Linux packages verified: $deb and $appimage"
