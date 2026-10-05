# Apple Speech platform adapter

This static Swift library exposes language readiness, explicit asset
preparation, and independent 16 kHz mono PCM16LE sessions. It never captures
audio. Normal session start checks the exact module's installed asset state
without reserving or downloading assets. The Rust wrapper owns operation
deadlines, bounded result delivery, and callback routing by unique identifier.

Apple silicon builds require Xcode 26+ with a macOS 26 SDK. The Cargo build
script compiles the bridge for macOS 13 and gates SpeechAnalyzer at runtime on
macOS 26. Intel macOS and other platforms compile an unavailable Rust adapter.
End users do not need Xcode or an external service. Each selected audio source
owns a separate native session.

Only the explicit Prepare speech resources action may request system assets.
Choosing a resource language does not change the session's recognition
language; select that separately before starting subtitles. Runtime language
choices are intersected with the selected text translator's implemented source
catalog. Original-only recognition retains the system's full supported set.

The model-free `tests/PCMQueueTests.swift` source covers bounded overflow, EOF
drain, and cancellation. Rust regression sources cover owned byte copies, late
callbacks, dropped handles, result queue overflow, and draining final results
before completion. CI selects the required Xcode and compiles the product bridge
through Cargo. Model experiment runners and benchmark reports are outside this
product change.

Regression source and compilation are separate from native app acceptance.
The signed Mimi identity, selected-source capture, resource readiness, text
translation, and visible overlay require an explicitly scheduled app check.
