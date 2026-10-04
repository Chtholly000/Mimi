# Apple Speech platform adapter

This static Swift library exposes only language readiness, explicit asset
preparation, and independent 16 kHz mono PCM16LE sessions. It never captures
audio. Normal session start checks the exact module's installed asset state
without reserving or downloading assets. The Rust wrapper owns operation
deadlines, bounded result delivery, and callback routing by unique identifier.

Apple Silicon builds require Xcode 26+ with a macOS 26 SDK. Swift builds for
macOS 13 and gates SpeechAnalyzer at runtime on macOS 26. Intel macOS and other
platforms compile an unavailable Rust adapter. End users do not need Xcode or
an external service. Each selected audio source owns a separate native session.

## Isolated verification

These commands do not start Mimi, change preferences, or capture live audio:

```sh
bash src-tauri/apple-speech/tests/build-smoke.sh
"${TMPDIR:-/tmp}/mimi-apple-static-smoke/smoke" --query
otool -l "${TMPDIR:-/tmp}/mimi-apple-static-smoke/smoke"
```

The build command runs model-free PCM queue tests. Verify `minos 13.0`, a weak
Speech framework load, and system `/usr/lib/swift` runtime paths in `otool`
output. Query is read-only; assets can be supported but not installed for this
test executable's identity even when another application is ready. Preparing
this executable does not prove readiness for the shipped Mimi identity.

Only run asset preparation when explicitly authorized. The remaining commands
exercise installed assets and the real static ABI, using a caller-provided
public or otherwise authorized PCM16 WAV (there is no automatic download):

```sh
smoke --prepare en-US
smoke --empty en-US
smoke --cancel en-US
smoke --reject en-US
smoke --transcribe en-US /path/to/english-sample.wav
```

`--transcribe` sends bounded 20 ms chunks at real-time speed. Diagnostics report
counts/timings only. Optional `--results /private/path/new-results.jsonl` writes
functional transcript events to a newly created mode-0600 file; keep that file
outside Git. EOF drains audio before finalizing results; cancel and rejected
callbacks close routing before freeing the receiver. The Rust unit tests also
exercise owned byte copies, late callbacks, dropped handles, result queue
overflow, and draining a final result before completion.

This proves the adapter boundary only. Signed Mimi identity, selected-source
capture, translation, and the visible overlay require separate app acceptance.
