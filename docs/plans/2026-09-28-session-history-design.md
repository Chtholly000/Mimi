# Opt-in local session history

The export page is a reading surface for current and past sessions. Past
sessions are grouped by local calendar day (Today, Yesterday, then dated
groups); selecting one shows confirmed source and translation pairs, newest
first, with search and 30-entry pages. The neutral layout follows Mimi's
settings design rather than the reference app's data table. Timestamps are
final-confirmation times, not speech onset or WAV playback positions.

The existing Keep subtitles and Record system audio preferences remain off by
default. Enabling either before a new session saves that content to local app
data when the session stops, including a normal app quit. The two data types
can be enabled independently; no third history switch is added. This changes
the earlier memory-only export design. During a live session, the bounded
archive buffers up to 10,000 confirmed pairs or 2 MiB and 64 MiB of PCM. Each
accepted pair and PCM chunk is also appended to a private local journal during
the session, so history is not dependent on an in-memory-only buffer. The
buffer is cleared after a successful final save. Explicit TXT and WAV exports
read the saved session. No microphone source or provider diagnostics change.

History uses one private JSON file per completed session and an optional WAV
sibling in the app data directory. Live sessions use append-only JSONL and
PCM files, which are readable after an interrupted process exit. UUID
filenames prevent path traversal. Final writes use private temporary files,
sync, and no-clobber commit; the JSON commit replaces the journal as the
authoritative session. Only the settings window has IPC
permission to list, search, play and delete saved sessions. Audio is loaded on
demand for playback, and the resulting object URL is revoked when selection
changes. Deletion removes both text and audio. Current buffers still clear on
opt-out, clear, a new session, or exit; saved history has its own explicit
delete action. A forced OS failure can lose the last unsynced journal writes;
normal stop or quit syncs the final files.

Core tests cover retained-pair paging and search. File tests cover session
save, list, read, delete and invalid IDs. Verify opt-in defaults, transitions,
history grouping, stale page responses, empty states, deletion, audio playback,
and light/dark layout in the signed development bundle. Real capture, audio
timing and distribution behavior require separate device testing.
