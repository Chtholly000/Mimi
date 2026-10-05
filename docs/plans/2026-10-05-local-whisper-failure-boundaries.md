# Local Whisper failure boundaries

Whisper's experimental DashScope adapter must preserve the earliest actionable
failure without exposing arbitrary exceptions. Pending-final overload and worker
or finish deadlines use fixed local-ASR codes; only exact source-owned labels
are public. Unknown failures remain generic. Public-fixture benchmark output may
retain preceding transcript events only in its explicitly requested private
file; ordinary terminal summaries contain no transcript events.

An empty final is a valid model outcome. After a preview it previously aborted
the whole session. Send the empty final and a new empty sentence-begin at the
next sentence ID, using Mimi's existing Audio3 boundary behavior to retract the
preview. The next real segment reuses this ID. Do not confirm the old preview,
synthesize final text, duplicate sentence IDs, or increase queues/deadlines.
An empty final without a preview remains silent and EOF completes normally.

Validate the real WebSocket path through two preview/empty-final cycles and a
subsequent confirmed sentence, plus empty EOF, fixed overload/timeout codes,
unknown error filtering, and a server close immediately after task-failed.
The single Japanese synthetic direct-chain case is transport/timing evidence,
not proof of native overlay behavior or general recognition/translation quality.
