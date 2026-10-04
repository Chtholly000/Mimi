# Parakeet local ASR bridge

## Scope and decisions

Provide an optional, independently managed Apple Silicon Python/MLX service
through Mimi's existing Custom ASR / DashScope WebSocket contract. This PR does
not bundle Python or model weights, introduce a new native provider, change user
credentials, or modify the running development app. Text translation remains
independently configured in Mimi. Deliver as a draft PR; do not merge.
The pinned MLX-Metal 0.32.3 wheel requires macOS 26 on Apple Silicon; this
optional service does not change Mimi's own deployment target.

Use NVIDIA Parakeet TDT 0.6B v3 through `parakeet-mlx` 0.5.3, with the
`mlx-community/parakeet-tdt-0.6b-v3` conversion pinned to
`ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15`. Weights are CC BY 4.0; the MLX
implementation is Apache 2.0. Preserve attribution and distinguish the community
conversion from NVIDIA's implementation. There are 25 supported European
languages; Chinese, Japanese, and Korean are unsupported.

Alternatives considered: upstream `transcribe_stream` keeps a growing finalized
token list and its default right context corresponds to about 20.48 seconds;
using it unchanged violates latency and retention requirements. A native model
integration would require a separate runtime/packaging project. This bridge
instead repeatedly decodes only one bounded speech segment using the normal
stateless model API. Drafts replace the whole segment. Silence or the segment
length limit confirms a final. Forced length boundaries may cut a word; this is
an explicit quality limitation to measure, not an assertion of native streaming.

## Data flow and bounds

Only `127.0.0.1` is bound, with browser Origin requests rejected. Setup generates
a private 0600 random local token once; runtime checks Bearer authentication in
constant time before creating a session. No token enters argv, logs or the
environment, and setup never rotates an existing token. One connection
is one source and one task. At most two connections share a single loaded model
worker; they retain separate PCM, sentence IDs and draft state. Model inference
is serialized. No source mixing, capture APIs or network inference exist.

The protocol accepts 16 kHz mono PCM16LE, with a 32 KiB maximum frame, 64 KiB
per-session input queue, 8-second segment, 240 ms preroll, 480 ms silence final
boundary and 800 ms draft cadence. A full queue fails explicitly. Fixed bounds
also apply to JSON and result text. No finalized transcript collection exists.

The model worker is a separate process. Runtime uses the downloaded local path
with offline mode enabled. Setup alone downloads pinned assets. Cancellation
discards that connection's pending results; EOF drains its queued PCM and final
before `task-finished`. A worker deadline fails the service, and stop has a hard
process deadline. An inference from a cancelled connection may finish internally
but cannot publish or be applied to another connection.

## Verification

Test segmentation boundaries, arbitrary PCM chunking, silence, bounded memory,
protocol validation, two-source isolation, cancellation, final order and worker
failure with a deterministic decoder. Then run the actual WebSocket service on
the archived public synthetic English sample and the shared extended suite.
Report model loading, process RSS, first nonempty draft, final/EOF latency, and
normalized WER. Synthetic samples verify this narrow input and bridge boundary;
they do not establish general ASR accuracy or native Mimi overlay acceptance.
