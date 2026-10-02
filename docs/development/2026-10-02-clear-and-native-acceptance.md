# Subtitle clear and native interaction acceptance

This follow-up addresses the remaining clear-result race and native interaction
checks from the [consolidated report](2026-10-02-live-iteration-status.md).
Verification results below are completed incrementally; unverified entries are
not claims of acceptance.

Current status: the `b7713df` application / `e78019d` Linux-smoke baseline passed
the checks below. The later repeated-caption and sudden-split fix is pushed as
`997bc523934228fe0747d63e8cb8b357f4820880`; its complete local canonical,
exact-source CI and representative signed-native checks passed as recorded below.
Slow/fast speech, song, repeated speech, three display modes, interaction and
ordinary-reopen preference restoration have been checked with the stated limits.
The user subsequently stopped the v1.5.6 release after another live-song
reproduction. PR #99 is a draft; no merge, v1.5.6 tag or release has occurred.
The Queen concert exposed previous-row one-line clipping and a confirmed old
preview surviving a newer raw source. These require further fixes and native
acceptance. The version files and [bilingual release notes](../releases/v1.5.6.md)
are preparation only. Earlier controlled-sample results do not establish
acceptance for this concert, and publication requires renewed user authorization.
The subsequent [concert reproduction report](2026-10-02-queen-live-reproduction.md)
records the narrow fixes, rejected segmentation trial and remaining limitation.

## Changes under verification

- Content revisions now survive provider transport queues. The manager checks
  them after acquiring the clear/apply gate, including local-history appends and
  outgoing state snapshots. Clearing also resets pending states and their timer.
- HQ clears HTTP previews/finals and queued work without replacing the ASR
  connection or clearing consumed request pacing, quota suppression or cooldown.
- Audio3 preserves a clear boundary across repeated clears, rejects continuation
  of the already observed sentence and accepts the next real sentence. Other
  routes clear their local assemblers and use available real item/turn boundaries.
- Secondary overlay controls expose pending/failure states. A rejected collapse
  rolls back only its matching optimistic frontend request.
- The macOS nonactivating subtitle panel can become key on user interaction,
  allowing its existing reading keys to receive input. First Home, End and
  first-click clear passed on the signed baseline; current-source mode-specific
  evidence and body-focus conditions are recorded below.
- Windows acceptance now requires fresh settings/overlay frontend mount markers
  on initial startup and restart, in addition to its native-window and lifecycle
  assertions. Linux keeps its packaged X11 smoke route.

## Clear semantics and limits

Clear removes displayed captions and opted-in current-session transcript text.
It does not stop audio capture, clear a recording, change retention preferences,
reconnect the provider, or bypass a rate limit. Provider failures still arrive.

For a cumulative sentence already observed by Audio3, clear resumes display at
its next real sentence boundary. Audio3 provides word timestamps, but the current
subtitle pipeline does not retain a word-timing boundary aligned with the Clear
action. Guessing text prefixes would lose or duplicate words. The first
recognition of audio that arrives only after clear cannot be classified
retroactively by capture time in the current pipeline.

OpenAI/Azure have no reliable source-turn boundary in the current translation
protocol: local buffered content, queued events and stale callbacks are cut, but
newly received deltas/done events remain service input. This is not a promise to
cut all providers' cloud audio at an exact wall-clock instant. Identity/range
tracking in other routes remains bounded and stores no cleared subtitle text.

## Current v1.5.6 source: `997bc52`

The complete local `./scripts/check.sh` passed for
`997bc523934228fe0747d63e8cb8b357f4820880`: **774 Rust passed / 1 ignored,
695 frontend passed across 76 files**. Format, strict clippy, type checking,
lint, frontend build and diff checks passed; the existing SoftwareUpdate Fast
Refresh warning remains. Desktop and Android versions agree at 1.5.6; Android's
versionCode is 10506.

The repeated-caption follow-up carries real Audio3 sentence identities through
drafts and reliable confirmations. A late confirmation of A appends A to history
without replacing a newer B draft or complete preview, including when B is still
buffered in the outer event transport. Complete previews carry their own opaque
layout owner; an ahead-of-preview raw sentence cannot donate its identity to an
older preview. Confirmed-source fallback does not create an extra live row while
the next translation waits. Fresh signed-native speech, song, repeated-input and
mode/restoration checks are recorded below.

Exact-source CI completed successfully:

- [CI 36973326403](https://github.com/yuxino/mimi/actions/runs/36973326403):
  Rust, frontend, MSRV and platform checks passed with the following actual
  logged counts.
- [Android 36973326168](https://github.com/yuxino/mimi/actions/runs/36973326168):
  succeeded. Logs confirm debug/release unit tests, debug/release lint and
  instrumentation-APK compilation (`BUILD SUCCESSFUL`, 2m 35s); individual JUnit
  test counts were not printed. Acceptance packages, disposable-key signing
  fixtures and both artifact uploads were skipped for this PR event. No device
  tests ran and no production APK was signed.

| Check | Passed / ignored |
| --- | ---: |
| Frontend | 695 / 0, across 76 files |
| macOS Rust | 774 / 1 |
| Windows x64 Rust | 775 / 2 |
| Windows ARM64 Rust | 775 / 2 |
| Linux Rust | 760 / 4 |
| Linux isolated PulseAudio / Secret Service / recovery | 1 / 0 each |
| Windows vendored WASAPI packet tests | 4 / 0 |

Scope, MSRV, format, strict clippy, Intel macOS target and aggregate CI passed.
The public HTTPS manual smoke remains ignored; Windows' default-output loopback
requires a physical playback endpoint and remains ignored. Linux's three
environment smokes are ignored by the bulk run but passed in their isolated
steps. ARM64 application compilation/UI startup, bundles, release preflight,
every formal release job and publication were skipped in this PR run.

No new package workflow is inferred from these PR runs. The earlier Windows and
Linux native-package results below remain baseline evidence. Formal package and
public-delivery verification belong to the v1.5.6 tag workflow and release page;
these PR checks are not publication proof.

## Signed macOS v1.5.6 verification: `997bc52`

The new signed development bundle built and installed in **1m 08s** at the fixed
development path, retaining its designated requirement. The native Settings UI
confirmed the revised sound-light copy and the user's latest preferences:
translation-only display, dividers off, 17px white centered text, pulse B and
motion on. These supersede the older bilingual/dividers-on baseline below.

Only authorized playback was used; other background playback was paused. The
following content-free measurements cover the controlled slow/fast samples:

| Measurement | Slow speech | Fast speech |
| --- | ---: | ---: |
| Observation window | 43.513 s | 31.560 s |
| Successful previews | 20 | 15 |
| Preview P50 / P95 / maximum | 293.5 / 382.8 / 398 ms | 364 / 507.1 / 554 ms |
| Successful final requests | 2 | 1 |
| Final P50 / maximum | 411.5 / 492 ms | 552 / 552 ms |
| HTTP 429 / translation failures / recovery / audio overflow | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Maximum pending final-queue depth | 1 | 1 |

These are request durations, not audio-to-screen latency or a future quota
guarantee. No recognized or translated text is included in this report.

- Native screenshots showed two complete slow-speech subtitle blocks. In the
  fast sample, the first line remained in place while reading across the final
  confirmation. Clicking Return to live restored three complete source and three
  complete translation lines, including the visible sentence tail.
- After the actual caption body had focus, Home and End succeeded in native
  screenshots. An initial End sent before that HTML body had focus had no effect;
  this is recorded as the focus condition, not evidence of a lost handled key.
- Two Clear actions immediately emptied the view; later fast/sung input
  continued on the same recognition connection.
- The three native display-mode mappings and complete translated sentence tails
  were confirmed. Source-only Home had accessibility-state evidence; its End
  result had a screenshot. These evidence types are not interchangeable, and a
  pixel-level source-only Home result is not claimed for this build.
- Immersion hid API/MT timing indicators in a screenshot. The application menu's
  Settings action remained an exit route, and immersion was restored off. The
  status-motion switch was checked off then on, without the removed system-help
  copy.

The song observation lasted **96.920812 s**, including a 6 s drain after the
90 s sample. It completed **14 previews** at **P50 262.5 / P95 399.25 / maximum
422 ms**, and **4 final requests** at **P50 254.5 / P95 273.1 / maximum 274 ms**.
HTTP 429, translation errors, recovery and audio-overflow counts were all zero;
maximum pending final-queue depth was one. Accompaniment still produced fragmented
or incorrect recognition. This sample does not establish improved music ASR
quality, nor that sentence identity prevents overlap reported under different
valid service IDs.

The same authorized fast-speech clip was played twice consecutively without
Clear between passes:

| Measurement | First pass | Second pass |
| --- | ---: | ---: |
| Successful previews | 16 | 15 |
| Preview P50 / P95 / maximum | 350.5 / 502 / 508 ms | 369 / 467.7 / 530 ms |
| Successful final requests | 1 | 1 |
| Final request duration | 570 ms | 584 ms |
| HTTP 429 / translation failures / recovery | 0 / 0 / 0 | 0 / 0 / 0 |
| Maximum pending final-queue depth | 1 | 1 |

The native accessibility tree retained two completed blocks in source-only mode;
translation-only mode also retained two complete blocks without discarding the
repeated content. Reading the first source sentence remained stable before and
after the second confirmation. This is representative repeated-input evidence,
not a guarantee for every ASR revision or music excerpt.

The Settings exit action then stopped the real session and closed the process.
Content-free logs recorded one `session stop requested` and one `session stopped`;
all five controlled playback processes had ended. An ordinary reopen without the
diagnostic launch environment confirmed the session off and the latest user
preferences restored: translation-only, dividers off, pulse B, pulse/subtitle
motion on, 17px white centered text, immersion off and lock off. Source Automatic,
Simplified Chinese target and System proxy had been confirmed before testing and
were left unchanged throughout.

Only the canonical development application remained installed/running; the
duplicate `target/release/mimi-dev.app` was absent and reusable build caches were
retained. These are end-of-controlled-test observations, not a promise that a
later user-started session remains off. The formal release application was not
replaced by this development testing.

## Automated verification: `2dc93bf`

The complete local canonical check passed with **764 Rust / 675 frontend tests**.
[CI run 36968817530](https://github.com/yuxino/mimi/actions/runs/36968817530)
completed successfully for exact source
`2dc93bf4065f8c23e0e894c1b9c786a2d4be1151`:

| Check | Passed / ignored |
| --- | ---: |
| Frontend | 675 / 0, across 76 files |
| macOS Rust | 764 / 1 |
| Windows x64 Rust | 765 / 2 |
| Windows ARM64 Rust | 765 / 2 |
| Linux Rust | 750 / 4 |
| Linux isolated PulseAudio / Secret Service / recovery | 1 / 0 each |
| Windows vendored WASAPI packet tests | 4 / 0 |

Scope, MSRV, format, clippy, Intel macOS target and the aggregate CI check passed.
The public HTTPS manual smoke remains ignored. Windows requires a real default
playback endpoint for its ignored loopback test; the three Linux environment
smokes ignored by the main test run passed in their isolated steps. ARM64 app
compilation/launch, application bundles and all release/publish jobs were skipped.
This CI proves neither packaged native startup nor real provider/audio acceptance.
It does not include the later first-Home and first-click source fixes.

## Automated baseline verification: `b7713df`

The complete local canonical check passed for
`b7713df3b673c711c229ba4cd62a8e3ec6886c65`: **764 Rust tests passed / 1 ignored,
679 frontend tests across 76 files**. Format, strict clippy, type checking,
lint, frontend build and diff checks passed; the existing SoftwareUpdate Fast
Refresh warning remains. The source/artifact scan reported no secret-like values
or generated artifact paths.

The following runs target that exact pushed source:

| Run | Scope | Status |
| --- | --- | --- |
| [36969650875](https://github.com/yuxino/mimi/actions/runs/36969650875) | Normal pull-request CI | Passed |
| [36969707363](https://github.com/yuxino/mimi/actions/runs/36969707363) | Full validation; Windows packages and x64/ARM64 UI-only startup smoke | Passed |
| [36969710377](https://github.com/yuxino/mimi/actions/runs/36969710377) | Quick validation; Linux .deb/AppImage installed X11 startup smoke | Failed at stale island-width assertion; corrected rerun below passed |

The normal PR run passed **679 frontend tests / 76 files, macOS 764 / 1 ignored,
Windows x64 and ARM64 765 / 2 each, Linux 750 / 4**, the three isolated Linux
smokes at 1 passed each and vendored WASAPI tests at 4 passed. Scope, MSRV,
format, clippy, Intel macOS and aggregate checks passed. The same manual HTTPS,
Windows real output endpoint and Linux environment-only bulk-run exclusions
listed above remain. ARM64 app compilation/startup and all bundle/release/publish
jobs were skipped in this PR run.

The Linux dispatch built both packages and installed the .deb. Its first native
launch passed fresh settings/overlay frontend markers, visible windows and a
synthetic listening session. A later geometry assertion failed because the script
still required the expanded panel's 280px width for the content-measured compact
island; the logged island was correctly anchored at **147 × 30px**. The script
now checks the existing 80–512px width bounds, exact height/anchor and containment.
Eleven local pure Bash positive/negative fixtures passed. AppImage execution and
later restart/lifecycle steps were not reached in that initial failed run.

The Windows dispatch completed successfully. The x64 MSI/NSIS build and portable
archive checks passed; both the built x64 executable and the extracted portable
executable passed native UI smoke. ARM64 app compilation and its native startup
smoke also passed. All three launches verified cold start, listener handoff,
tray/session retention, minimized/tray-hidden activation, fresh frontend
mount/restart and five-second health checks. The platform test counts matched
the normal PR run. The CI artifact
[mimi-windows-2025](https://github.com/yuxino/mimi/actions/runs/36969707363/artifacts/11210949118)
was uploaded; release/publish jobs were skipped.

The corrected Linux script was pushed as
`e78019d7e9c6664caf6b32c2407b72f5217e48fe`, with application code unchanged from `b7713df`.
Its [Linux package rerun 36970479894](https://github.com/yuxino/mimi/actions/runs/36970479894)
and [normal PR CI 36970455610](https://github.com/yuxino/mimi/actions/runs/36970455610)
both completed successfully. Each run passed **679 frontend tests / 76 files,
macOS 764 / 1 ignored, Windows x64 and ARM64 765 / 2 each, Linux 750 / 4**,
three isolated Linux smokes at 1 passed each and vendored WASAPI tests at 4 passed.
MSRV, format, clippy, Intel macOS and aggregate checks passed. ARM64 app startup
was skipped in these two runs; it was exercised by the earlier Windows dispatch.
All release/publish jobs were skipped.

The installed .deb executable and packaged AppImage each completed three native
X11 starts under Xvfb/Openbox. All six passed fresh settings/overlay frontend
markers, visible windows, synthetic listening, exact island attachment and native
move following, stop-hidden/restart-reattachment, existing-instance session and
immersion commands, and close-to-exit. The Linux CI artifact
[mimi-ubuntu-22.04](https://github.com/yuxino/mimi/actions/runs/36970479894/artifacts/11211812099)
was uploaded. This is packaged native UI-only acceptance on hosted X11, not real
desktop-provider/audio or Wayland device acceptance.

These dispatches do not publish a GitHub Release or updater assets. Package startup
checks use synthetic UI-only state and cannot establish real provider, audio,
physical desktop or Android device acceptance.

## Signed macOS native acceptance: earlier `2dc93bf`

The signed development build of `2dc93bf` passed a slow-speech clear test:

- Previously displayed text disappeared and did not repopulate from cleared
  pending work. Later new source and translation continued on the same recognizer
  connection; capture did not stop and the session did not reconnect.
- Slow-speech preview request timing: **n = 18, P50 300.5 ms, P95 366.85 ms**.
  The single confirmed translation request measured **405 ms**. Observed HTTP
  429, request errors, reconnects and audio-overflow events: **0**.
- A fast-speech sample in the same session measured **n = 14 previews,
  P50 373.5 ms, P95 455.1 ms, maximum 472 ms**; its single confirmed translation
  request measured **598 ms**. HTTP 429, preview/final failures, audio overflow
  and recovery events were **0**; maximum pending final-queue depth was **1**.
- Native End returned reading to the live tail. The first Home could remain at
  the former compact-row offset, and a first control click could only focus the
  WebView. These defects were fixed and retested on `b7713df` below.
- Native ⌘Q closed this development instance. This confirms ordinary app exit,
  not forced termination or operating-system shutdown cleanup.

These are request-duration and interaction observations for the slow/fast samples
in one session, not audio-to-screen end-to-end latency or a guarantee against
future rate limits. Other providers' clear boundaries have focused fixtures, not new
live credentialed acceptance in this follow-up.

## Signed macOS native baseline: `b7713df`

- A single first clear click immediately emptied the captions. Later new source
  and Chinese translation continued without old text repopulating, on the same
  recognizer connection.
- First Home reached the beginning in bilingual, source-only and translation-only
  display, confirmed visually. End returned bilingual and translation-only views
  to the live tail with complete final visible lines. Source-only End was invoked
  without an independent tail screenshot. The focus ring stayed thin and neutral.
- Collapsed pause and expand controls remained available; expand worked. The
  three display modes were changed through the actual control-panel select and
  synchronized with Settings. The user's original bilingual display was restored.
- Slow-speech previews: **n = 18, P50 297 ms, P95 361.55 ms, maximum 376 ms**;
  its single final request measured **291 ms**. Fast-speech previews: **n = 14,
  P50 363.5 ms, P95 465.05 ms, maximum 480 ms**; its single final request measured
  **565 ms**.
- Each sample recorded **0 HTTP 429, preview/final failures, audio-overflow and
  recovery events**, with maximum pending final-queue depth **1**. The same
  connection was retained. These are request durations, not audio-to-screen
  latency or a future quota guarantee.

## Remaining native acceptance

- Media focus on first control activation remains unverified; first clear click
  and Home in all three display modes passed on the `b7713df` signed baseline.
  Current `997bc52` mode mappings and reading actions passed with the source-only
  Home accessibility-only limitation recorded above. End had visual evidence.
- Full-screen QuickTime was opened, but an injected ⌘⇧B produced no visible
  change and the available screenshot showed only a window. This does not prove
  physical global-shortcut handling or subtitle coexistence over full-screen
  media.
- Tooltip/hand-cursor pixels, physical global shortcuts, actual Dock-menu quit
  and native save-failure recovery still require the specific native checks;
  neither Force Quit nor operating-system shutdown cleanup is claimed.
- Windows x64/ARM64 and Linux packaged native-smoke CI passed for the exact
  baseline heads above. Fresh `997bc52` source CI also passed, but it did not
  build or launch new packages. Formal version-package results must be read from
  the v1.5.6 tag CI and release page.
  These are credential-free startup checks, not physical device/provider/audio
  acceptance.
- Android: no Android SDK, emulator, adb or known AVD installation was found in
  the current environment's PATH or conventional locations; this does not rule
  out an unknown custom installation. No device was scanned or modified. Android
  physical device acceptance remains unavailable here.

No formal release was performed during the baseline checks above. The user's
later authorization adds v1.5.6 release preparation and final verification to the
current scope. Development testing still does not replace the installed formal
release bundle or establish production permission/credential continuity.

## Development handoff

The Settings exit button was used at the end of the controlled final real session. The process
exited; content-free counters recorded one `session stop requested` and one
`session stopped`. An ordinary reopen without the temporary diagnostic launch
environment showed the session off and the saved user display preferences:
bilingual, 17px white centered text, dividers and motion on, pulse B, immersion
and lock off. The saved Dock-on baseline was unchanged; this is not proof of an
actual Dock-menu quit.

The off state describes that controlled-test reopen, not a claim that the app
remains idle. A later active session was left untouched; no subsequent content
or media was included in this report.

Read-only process/path checks found exactly one running development executable
at `/Applications/mimi-dev.app/Contents/MacOS/mimi` and one installed development
bundle. The duplicate `target/release/mimi-dev.app` was absent, and reusable
build caches were retained.
