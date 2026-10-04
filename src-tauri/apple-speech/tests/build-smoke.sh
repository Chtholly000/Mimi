#!/bin/bash
set -euo pipefail
speech_dir="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="${MIMI_APPLE_SMOKE_DIR:-${TMPDIR:-/tmp}/mimi-apple-static-smoke}"
mkdir -p "$build_dir"
sdk="$(xcrun --sdk macosx --show-sdk-path)"
compiler="$(xcrun --find swiftc)"
swift_lib="$(dirname "$(dirname "$compiler")")/lib/swift/macosx"
swift_flags=(-parse-as-library -swift-version 6 -warnings-as-errors -target arm64-apple-macosx13.0 -sdk "$sdk" -module-cache-path "$build_dir/module-cache")
"$compiler" "${swift_flags[@]}" -O -emit-library -static -module-name MimiAppleSpeech "$speech_dir/PCMQueue.swift" "$speech_dir/Bridge.swift" -o "$build_dir/libMimiAppleSpeech.a"
xcrun clang -std=c11 -Wall -Wextra -Werror -target arm64-apple-macosx13.0 -isysroot "$sdk" "$speech_dir/tests/smoke.c" "$build_dir/libMimiAppleSpeech.a" -L"$swift_lib" -L"$sdk/usr/lib/swift" -Wl,-rpath,/usr/lib/swift -o "$build_dir/smoke"
"$compiler" "${swift_flags[@]}" "$speech_dir/PCMQueue.swift" "$speech_dir/tests/PCMQueueTests.swift" -o "$build_dir/queue-tests"
"$build_dir/queue-tests"
printf '%s\n' "Built $build_dir/smoke (no model started or downloaded)."
