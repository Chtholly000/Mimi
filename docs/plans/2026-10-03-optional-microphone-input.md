# Independent system and microphone input — issue #100

## Product behavior

Settings → Speech & Translation offers separate System audio and Microphone
switches. Either or both can be enabled; at least one stays selected. Existing
and fresh preferences default to system audio only. Choosing an input never
opens a device: capture and any necessary microphone permission start only
when the user starts subtitles. Source selection is global and independent
of service profiles. Both lanes use the selected profile and language settings.
Two enabled sources open two service connections and incur the corresponding
provider usage. Android capture is unchanged.

Each source has independent capture, bounded PCM ingress, provider client,
content revisions, subtitle assembly, translation progress and timeout state.
Audio is never combined before recognition. Overlapping speech and identical
provider utterance IDs must remain separate. The overlay identifies System
audio and Microphone, because system output may contain media or multiple
people rather than one remote speaker. Non-essential usage, permission and
headphone advice belongs in compact hover/focus help, not persistent small print.

## Lifecycle and permissions

Snapshot the enabled inputs at manual start. Pause, resume, language/mode
changes and recovery retain that selection. Source changes require stopping,
including connecting, paused, recovery and stopping states. Each source uses
the existing selected-input capture implementation, with independent native
handles and queues. Start commits Listening only after all selected sources
are ready. Failure or cancellation of either source cleans up the whole
generation; it must not leave a hidden microphone or silently continue with
one source. Stop drains bounded final work and releases both native handles.

Microphone-only sessions do not request system-audio capture permission;
system-only sessions do not request microphone permission. macOS bundles
include NSMicrophoneUsageDescription and the audio-input entitlement. Linux
resolves output monitors only for system audio and a non-monitor default input
for microphone. Windows output selection applies whenever system audio is
selected. Defaults are resolved at each capture start; mid-session device
selection is not offered. Headphones are recommended for two-input use because
this change does not provide acoustic echo cancellation.

## Subtitles and local files

Each input retains its own bounded drafts and confirmed display history.
A source-aware combined history preserves confirmation order for the normal
history view and export. Clearing subtitles invalidates both clients' previous
content revisions before clearing local text, so delayed translations cannot
restore cleared content. Preview and final work from one input cannot overwrite
or complete pending work for the other input.

Saving subtitles and audio recording remain separately opt-in and default off.
Changing the input selection clears recording consent even if the same settings
draft also requests recording. Confirmed text carries source identity in the
private local journal. Audio is written to separate source tracks as it arrives,
never retained for the full session in memory or concatenated into one WAV.
Audio playback/export requires a source choice when both tracks exist. Existing
single-track recordings and untagged transcripts remain readable. Disabling
recording clears all current-session tracks; saved sessions require explicit
deletion. Diagnostics remain content-free.

## Verification and delivery

Cover legacy preferences, all three nonempty selections, source-locking and
recording-consent reset; independent overlapping drafts/finals and pending
states; per-source revisions and stale generations; cancellation and teardown
when one source fails; independent bounded queues and PCM paths; separate
recording, clear, delete and export paths with legacy-file compatibility.
Run scripts/check.sh, inspect the signed macOS development app in UI-only mode,
and run native-platform PR CI including simultaneous Linux PulseAudio capture.
UI fixtures prove rendering and IPC behavior, not physical microphone permission
or cloud recognition. Report live hardware/provider verification separately.

Update PR #108 for review; do not merge main, tag, package a public release or
publish a release as part of this change.
