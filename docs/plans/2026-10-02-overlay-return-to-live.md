# Explicit return to live subtitles

## Decision

Add a visible “Back to live” action while the user reads complete subtitles.
Keep the existing atomic original/translation pairs and measured visual-line
budgets. Do not zip paragraphs into sentence pairs by matching sentence counts:
translators may merge, divide, or reorder sentences even when both sides contain
the same number. Successful punctuation segmentation does not establish semantic
alignment. No unused sentence helper or prototype is included in production.

The independently cropped tails of a long bilingual paragraph can refer to
different parts of that paragraph. This reading affordance does not repair a
stale or incorrectly translated backend pair; those defects require their own
confirmed-identity, translation-memory, and clear-boundary fixes.

## Interaction and state

Upward wheel/key/touch intent opens full confirmed and current live text and reports reading
state to the overlay. Incoming content, pause/resume, display-mode changes, and
resize retain that deliberate reading position. Previously only End or scrolling
back to the bottom resumed live following.

The new action increments a controlled follow-tail request. Timeline responds
through its existing `TimelineScroll.followTail` API and returns its lane
presentation to compact following before paint. Reading state is stamped with
the request, so a request is applied once without timer work or a second command
on a later render. A new upward gesture can enter reading again. End and normal
scroll-to-bottom behavior remain available.

The action is outside the timeline's direct children: canonical subtitle-block
IDs and reading anchors remain intact. Clear removes empty timeline content,
cleans up the reading callback, and hides the action immediately. A subsequently
mounted session starts in live following. No preview is promoted to confirmed
history; snapshots and saved session files are unchanged.

The current live row also opens on deliberate reading, even when no final has
arrived. Its earlier content must not remain trapped behind a finite lane while
the return action is visible. Default following still clips to measured whole
lines. A live row is the latest replaceable snapshot, bounded by the existing
64KiB-per-field limit; this does not archive previous draft revisions. Recognition
corrections can change its text while the reader keeps a block/pixel anchor.
Final promotion changes the canonical row ID, so the existing missing-anchor
policy preserves the current scroll position rather than forcing the tail.

Returning before compact lanes finish measuring can leave the scroll position
above the eventual tail. Observe the fixed viewport and its direct subtitle rows,
then use the existing reflow policy when row height changes: following repins to
the current bottom; reading restores its anchor. Rebind row observations only
when block IDs change, not for every draft. Explicit return intent runs after a
same-render mode change, so the mode anchor cannot override that action. No timer
or forced jump while deliberately reading is added.

Native scroll notifications are not themselves return-to-live intent. A final
can replace the live row ID, change its height, and produce a delayed scroll
at the newly clamped bottom without any user action. Every programmatic
restoration clears input authorization, including a missing reading anchor;
restoration never re-arms it. Upward reading input also does not authorize
returning. Scroll input is consumed once, with real pointer movements renewing
a scrollbar drag. Passive notifications can refresh the visible canonical
anchor while preserving reading. Only a new downward gesture, End, or the
explicit return action can resume following; no timer guesses user activity.

## Geometry and copy

Use the existing status band with a small neutral text button on its right.
Timing or action-error feedback flexes into the remaining width and is still
available. The active band remains 61px high; its status row starts at 47px and
is 14px high, below the native language capsule and above the subtitle body.
This preserves the 51px bilingual body budget at the native 360×136 minimum.
The button has a visible focus outline and ordinary hover/pressed affordances.
Idle history uses the existing smaller band's status position.

Copy is synchronized in Chinese, English, and Japanese: “回到实时”, “Back to
live”, and “リアルタイムへ”. There is no automatic jump on resume and no new mode.

## Verification

Synthetic component regressions cover explicit return to the tail and continued
following, later upward reading intent, reading retained through all display
modes and pause/resume, clear/new-session reset, and coexistence of the action
with timings and failed control feedback at the native minimum in three UI
languages. Private acceptance audio/captions are not fixtures. Native acceptance
must still check the actual small-window text geometry, focus/click reachability,
and slow-speech paired subtitles; component checks do not replace those checks.
Long-live fixtures also cover all three display modes, full text before a final,
equal-length rewraps, continued growth, explicit return to compact following,
and live-to-final promotion while retaining reading intent and scroll position.
Size-change regressions exercise delayed compact-row growth/shrink, replacing a
row with the same block count, and preservation of deliberate reading during
those notifications. This models the native post-measurement scrollHeight change
without claiming that mocked component geometry replaces native verification.
Final/geometry fixtures dispatch the later native-style scroll after the live
ID disappears and after a row is clamped to its bottom in all three modes.
They assert that full reading and the return action remain until fresh downward
input, and that a stationary pointer click cannot implicitly resume following.
