# Bounded external local MT experiment

## Decision

Keep dedicated translation models outside Mimi's transport and shared subtitle
policy. An opt-in Python loopback adapter accepts the existing OpenAI-compatible
request, extracts only its exact selected language pair, and renders a reviewed
candidate template. This avoids altering the generic upstream prompt or creating
desktop-only provider semantics that Android cannot share.

A direct generic request is a useful control but may violate a dedicated model's
template. Changing every OpenAI-compatible request would affect unrelated servers.
A candidate-specific local adapter gives a reproducible boundary while keeping
the application unchanged. Python/aiohttp is an isolated operator dependency,
chosen for cancellation-safe streaming reads and disconnect handling. It is not
packaged with Mimi, does not install at application startup, and requires manual
setup. Weights and venv remain in the user's local data directory.

## Invariants

- Revision, byte size and SHA256 are pinned; partial downloads cannot become
  active models. The operator supplies an existing llama.cpp binary.
- The adapter and owned backend bind to loopback. The backend requires an
  owner-only random token; the external adapter allows native local clients and
  rejects browser Origin/unexpected Host. There is no remote or cloud fallback.
- Exact source/target selection is carried from Mimi's known request template.
  Auto or unsupported languages fail; no content-based inference or prompt edits.
- One inference slot, bounded JSON/text/output/context, seven-second deadline,
  no queued concurrent translation requests, and cancellation on disconnect.
- Readiness proves an owned backend listener and expected model alias. Stop
  validates process identity, cancels loading, and reaps only the owned child.
  The runner holds a cross-candidate lock through the end of cleanup.
- Application settings, credentials, capture, recording, subtitles, common
  translation contracts, and final/draft policies are unchanged.

## Verification and remaining boundary

Fake service tests verify lifecycle, ownership, authentication, cancellation and
size limits. Same-text model comparisons preserve raw public synthetic replies,
model/runtime hashes, templates, sampling and elapsed HTTP timings. Categorized
semantic review is an AI-assisted inspection against prewritten meaning notes,
not a blind human assessment or a benchmark accuracy percentage.

Successful HTTP output is separate from meaning preservation. A model may return
200 while repeating source text or altering negation/game terms. Native Mimi
capture and rendered subtitles require a further signed-dev run; script tests and
direct model inference do not establish that acceptance. Keep these experimental
routes optional and do not recommend replacing the current translator without
evidence from the actual domain and representative speech.
