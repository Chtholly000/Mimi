# Explicit return to live subtitles

## Decision

Add a visible “Back to live” action while the user reads confirmed history.
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

Upward wheel/key/touch intent opens full confirmed text and reports reading
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
