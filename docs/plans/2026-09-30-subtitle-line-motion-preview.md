# Subtitle boundary and phase-indicator preview

Refs #67 and #87. This is a reviewable refinement, not final visual approval or native acceptance.

## Scope

Preserve #67's sentence blocks, streamed-word entrance, stable finalization, age fade, line budgets, and independent motion preferences. The source preview's local lane-order, hover and scroll-continuity changes are not imported by this integration patch. Settings layout, font selection, compact status labels, audio capture, and phase derivation are outside this change.

- Keep sentence separators in card mode, with a static 0.65 CSS-pixel hairline, gentle edge falloff, and an 8px margin instead of 6px. Immersive mode continues to use spacing only.
- Hide timestamps by default and remove the unused metadata gutter. `Timeline.showTimestamps` restores the original timestamp/gutter when requested. This is a component option; no persisted user-facing settings switch is added here.
- Keep the CSS ring/dot indicator and semantic phase colors. The preview distinguishes a slow connection arc, a quiet listening halo, recognition rings, and translation arcs. Idle, paused, and error remain still. These details are candidates for separate visual review, not a claim to reproduce an earlier indicator exactly.
- Respect each resolved motion preference independently. Disabling subtitle motion must not disable an explicitly enabled indicator; disabling indicator motion leaves static phase shapes. No animation measures audio amplitude or percentage completion.

## Design provenance

PR #67 at `3128c46c0c594aaa1cd899c2dd5630182ac3154c` and the comparison base `a7b6297` contain the same PulseRing implementation. The uniform ripple was introduced earlier in `2795365`; it must not be attributed to #67's contributor. Before that commit, WaveformIndicator used phase amplitude and RecognitionActivityIndicator added a translation glow/ring. The refinement is a new candidate informed by that history.

## Existing evidence

The comparison uses the original #67 Timeline, the Timeline at `a7b6297`, and this candidate in the same browser canvas with identical synthetic bilingual sentences and seven phase indicators. Shared supporting modules come from the comparison base. It is not a whole-window/native before-and-after capture.

- [Public original comparison and video](https://github.com/yuxino/mimi/blob/6d4206648eab09c7b0523dba0ce8b5fc8194a407/README.md), pinned to an evidence-only commit. The three rows use PR #67 Timeline source, local `a7b6297`, and its `113a340` candidate respectively; none is an exact integrated native capture.
- The video contains 8.04 seconds of running React/CSS components, 1920 x 1530, with original sampled frame timing (approximately 5–6 fps). It was played and inspected at 2s and 5s; it is not a static screenshot presented as motion.
- Browser reduced-motion emulation yielded zero running animations and zero animations for all seven candidate phases. Enabling the component timestamp option restored both timestamps.
- Frontend suite: 193 tests passed. Typecheck and production build passed. Lint had zero errors and one existing SoftwareUpdate Fast Refresh warning. Diff whitespace check passed.

## Integration boundary

This change is isolated for review and conditional inclusion in the single integration PR. Keep the current compact-label/source geometry and resolve font/types/settings conflicts in that integration branch. Do not describe the candidate's visual details as approved merely because #67 is approved for inclusion.

The full canonical Rust check, signed native expanded/collapsed/empty/error/paused/long-subtitle inspection, and real audio/provider acceptance have not been run for this candidate. Local preview/server/browser processes were closed at the user's request; do not restart heavy local checks outside the integration coordinator's schedule.

## Adaptation into #88

Only the separator, optional timestamp and phase-indicator hunks from `113a3408782bf7c635ba703f24b4b4fede053094` are adapted onto #67. Its parent history, local presentation helper, lane ordering and hover/scroll changes are not imported. #72 compact labels and source geometry remain intact. The card Timeline now receives the resolved subtitle motion preference, and new-block smooth scrolling respects it; this prevents a disabled subtitle animation from retaining JavaScript scrolling. Separately, an integration regression keeps identical original/translated text visible in translation-only mode. Remote CI validates this new tree; earlier preview checks remain source evidence only.
