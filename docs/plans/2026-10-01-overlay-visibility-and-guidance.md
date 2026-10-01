# Live subtitle feedback: visibility, space, controls and timings

The user requested clearer status, a larger empty-overlay indicator, less
wasted subtitle space, bounded long-sentence presentation, simpler controls,
a discoverable guide, meaningful latency readings, and quicker reactions to
short recognition drafts. Work branches from merged integration #88 and is
reviewed through a new PR; this iteration publishes no version.

Only A (syllable) and B (ribbon) remain. B is the default; legacy classic and
unknown saved values migrate to B without changing the animation preference.
Compact indicators grow to 24px. The empty overlay has a prominent 48px/80px
variant scaled to the space remaining after the control band and status line.
Stronger strokes and less compounded opacity improve visibility while
preserving explicit animation-off and reduced-motion behavior.

The expanded panel uses two compact selectors, a single-line audio status and
single-line immersive/lock switches. Its native width is 280px and initial
height 270px; React still measures the actual localized height. On macOS the
status reports the current default system output name, read without changing
ScreenCaptureKit's mixed system-audio capture route. A missing name omits the
unknown-device placeholder. Device names stay in the local UI and never enter
logs or copied diagnostics. Windows retains its audio-output settings entry.

Turbo is the sole active translation mode. Old mode values remain readable
and normalize to Turbo through configuration validation, preference snapshots,
saves and language changes; no mode selector remains. ASR source drafts appear
as soon as a free preview lane permits them. A worker retains its matching
source line while translating; replacing a draft clears its old translated
preview. Confirmed source/translation pairs remain atomic and durable.
Replaceable previews use 250ms stability and a 1s maximum wait. Meaningful short
unpunctuated drafts can preview without the old 12-character gate. Final work
keeps priority, and cancellation, bounded queues and stale-worker guards remain.
This improves local waiting and presentation; music recognition quality still
requires actual provider/session observation.

The normal overlay reserves a 61px active/error top band, separating the drag handle
from the native capsule and leaving room for timing labels. Short lines use
actual measured height instead of occupying their full line budget. Following
live output bounds both confirmed and live presentation to finite tails; a new
sentence no longer expands its predecessor into a wall. Upward wheel,
Home/ArrowUp/PageUp or a deliberate touch scroll opens complete confirmed
history with the same reading anchor. End or returning to the bottom resumes
compact following. A ResizeObserver adapts bilingual lanes from 1+2 to 1+1 in
short windows; absent source text leaves the available space to translation.
The native minimum expanded height is 136px so the controls and default-sized
bilingual lanes fit; the collapsed strip keeps its existing smaller height.
Complete text stays available in the DOM/accessibility tree and local history
retention remains independently opt-in.
Short subtitle output aligns with the lower reading edge; overflowing history
keeps its ordinary scroll flow. Error states retain the same capsule clearance
and right-side controls, with the first action restarting the session.

Getting started is a persistent, manually opened settings-sidebar entry with
three steps and service/subtitle navigation. It does not start capture, save
credentials/preferences or write a completion flag. Redundant sidebar borders
and the details disclosure are removed; sanitized diagnostic copy, GitHub
feedback and a visible manual-copy fallback remain.

The normal expanded overlay shows the latest API round trip from the existing
connection health check, without additional requests or polling. Translation
duration covers a successful nonempty final Turbo/DeepLX text request,
including retries but excluding ASR, queue and preview work. The legacy
end-to-end client measures matching source-final to translation-final receipt
as translation wait; a translation received first has zero additional wait.
Unsupported or unavailable observations show an em dash. Timings are
content-free and clear across inactive/paused/error/reconnecting or stale
generations; original-only mode has no translation sample. Immersive mode
keeps the requested status/timings without a background panel, and its help
text describes this presentation in all three UI languages. Characters per second is omitted:
provider batching and sentence length make it less useful than elapsed time
for diagnosing the user's reported delays.

Verification covers timing/pairing/lifecycle and migration tests, short-preview
HTTP fixtures, bounded layout and reading behavior, settings navigation and
clipboard fallback, all three UI languages, motion preferences, the canonical
repository check and signed native inspection. UI fixtures and CI establish
correctness, not real service latency or music recognition quality. Real
provider timing requires a user-started session and is reported separately.

Service configuration uses the existing unified selectors throughout. The
Alibaba text override has three routes: follow the current service, DeepL's
official API with its preset host, or a separately configured custom service
using the existing DeepLX JSON contract. DeepL and custom secrets occupy one
profile-scoped Keychain record with distinct fields; switching routes preserves
both and never moves either key into the other route. Existing legacy custom
profiles retain their original ASR credential item and migrate destinations
without changing its value. Failed reads can be retried after unlocking.
DeepL does not add a capture provider: Alibaba continues recognizing system
audio. The official HTTP client bounds response sizes, disables redirects,
supports cancellation and reports only sanitized error categories.

Checking a connection waits for the provider's authenticated ready event and,
for split recognition/translation routes, validates a fixed synthetic text
request. Transport reachability alone cannot produce "Available". Probes send
no system PCM or user subtitles, close their connections on every result, and
return a concise status with a short safe reason. The provider list uses
bundled official logos with uniform sizing and recorded asset provenance.

Native playback acceptance uses downloadable licensed reference media across
slow/normal/fast speech and singing. Compare audio receipt, first source draft,
translation completion, stale/error recovery, narrow/short overlays, and history
reading. Keep measurements content-free and document material limits separately
from automated fixture results.
