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

The protocol accepts 16 kHz mono PCM16LE, with a 32 KiB maximum frame, 64,000-byte
per-session input queue, 8-second segment, 240 ms preroll, 480 ms silence final
boundary and 800 ms draft cadence. A full queue fails explicitly. Fixed bounds
also apply to JSON and result text. No finalized transcript collection exists.
Accept the optional single `user` / `input_text` context object emitted by Mimi's
current Rust client, bounded to 4,096 UTF-8 bytes. Discard this compatibility
hint rather than claiming Parakeet applies it to recognition. Regression
requests include the actual Rust client's context, heartbeat and punctuation
parameters; empty-input-only fixtures missed a real native setup rejection.
An explicit `--silence-ms` option permits 240/320 ms comparison without changing
the default. Queued final inference takes priority over queued drafts, and a
source keeps only its latest waiting preview. An in-flight preview superseded
by its final cannot publish. Neither rule drops audio or final work. In-flight
inference cannot be preempted safely.

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

Completed: 23 deterministic/loopback tests, pinned setup and repeated startup,
actual model replay of the 9.518-second synthetic English sample, the shared
96.263-second continuous 24-sentence sample, and the 11-second JFK sample.
Literal WER was respectively 1/30, 13/239, and 0/22. Default-endpoint simultaneous
dual-source replay finished within 96/184 ms of EOF. The 320 ms candidate did not
improve the short sample's first-final boundary, so the default stays 480 ms.
See [measured boundaries and limitations](../../tools/parakeet/README.md#measured-on-2026-10-05).
Native routing was subsequently checked with bridge `6f880be` and Mimi dev
`301cfb3`: the recognition check took 51 ms, and the public short sample passed
through system capture, Parakeet and Index to a final English/Chinese pair in
native app diagnostics. History/recording and microphone capture were off.
The service was stopped afterwards. The eight-second cut still yielded a
fragment; full-sample correctness and complete subtitle-overlay visual
acceptance remain unverified. Exact binary provenance and scope are recorded in
the README and integration ledger.


## Recovery from contended inference and empty finals

The 2026-10-05 content-free service log exposed four `empty_final` session
failures and one `audio_queue_full` before additional unsupported-language
attempts. The queue failure followed decodes of 1,112.8–1,984.3 ms. The former
pipeline awaited each decode while its two-second input queue kept filling.
These observations identify failure boundaries, not transcript correctness.

Split each session into bounded receiving, segmentation and inference tasks.
Keep the 64,000-byte / 101-packet input bounds. Keep up to two pending final
snapshots (512,000 PCM bytes), one replaceable preview (256,000 bytes), one
active inference (256,000 bytes), and the existing bounded segmenter. IPC and
WebSocket buffers remain separately bounded. Final snapshots preserve all
segment PCM and FIFO order; final work outranks waiting previews. Old preview
results cannot publish after that sentence's final has been queued. A full
final backlog fails explicitly instead of dropping final audio or hiding a
worker that cannot sustain the input. Cancellation tears down all session tasks;
EOF preserves the existing 20-second drain deadline.

An empty final must never become a session error or promote an unconfirmed
draft. Mimi's existing decoder ignores empty finals, and a repeated empty begin
for the same ID does not retract a preview. Therefore, only when a final is
empty after a published draft, send that empty final and reserve the next ID
with an empty begin. This crosses the existing preview boundary, cancels its
pending translation, and creates no history. The next actual sentence reuses
that ID; EOF creates no fabricated final for a merely reserved boundary.
Existing finalized translations are not changed. This compatibility adaptation
requires no shared subtitle-policy change.

Valid setup with unsupported language hints has its own fixed wire error code,
`UNSUPPORTED_LANGUAGE`, and sanitized label `unsupported_language`. Other
malformed setup stays `CLIENT_ERROR` / `invalid_setup`; no new languages are
claimed. Regression tests cover empty-final retraction, consecutive boundaries,
EOF, slow decoding with more than two seconds of arriving PCM, fixed overload
bounds, obsolete previews, and the setup error distinction. Native reproduction
under concurrent Index load remains a separate acceptance check.

Targeted verification of this repair: all 31 synthetic/loopback tests pass.
The empty-final and slow-decoder regression cases also ran against the prior
bridge implementation in a temporary directory and failed with the same
`empty_final` and `audio_queue_full` labels observed in the service log. No live
service or model was started or stopped by these checks. This is regression
evidence, not a new native speech-quality or concurrent-model acceptance run.

The repository canonical check also passed for `9dbea99` plus this repair:
desktop Rust 1088 passed / 2 ignored; frontend 110 files / 1444 tests; shared
core and actual JNI, strict Clippy, lint, typecheck and production build passed.
Existing Cargo output was reused. This does not change the outstanding native
long-session and concurrent-Index verification limits.
