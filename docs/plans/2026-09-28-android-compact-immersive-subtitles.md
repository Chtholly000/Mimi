# Android compact and immersive subtitles

The Android port keeps Mimi's desktop visual language: grayscale surfaces, the
existing character artwork, one primary session action, and a live subtitle
overlay. The supplied mobile reference is a floating reading window over other
content. Mimi starts with a compact subtitle; tapping it opens a translucent
reading panel with a language route, type-size control, and collapse action.
The panel stays short when history is off. If history is enabled in settings,
it grows into a scrollable window for bounded confirmed subtitle pairs. There
is no extra recording or preview control in the floating panel.

Normal mode shows the current translation in a compact translucent card, with
the source line for English speech. The reading panel always shows the current
source and translation. The compact card's background opacity remains
adjustable, and users can drag it vertically. New installations use a readable
65% dark background; an existing saved value still wins. History remains off by
default and never appears until explicitly enabled in settings.

An appearance switch enables immersive mode for the next session. The overlay
then has no background, hides history, uses a text shadow for contrast, and is
not touchable. Android 12 and newer reject touches passing through a fully
opaque untrusted overlay, so the immersive window's opacity is capped at 0.8.
Because the text cannot receive gestures, the app and foreground notification
remain the controls for stopping or changing the mode. The ordinary card stays
touchable for dragging.

Mode and appearance settings save separately from provider credentials. A
debug-only instrumentation fixture renders the actual floating window over the
emulator home screen without a service account, capture permission, or network
session. Its synthetic subtitles are only for visual checks, not evidence of
live translation. Verify compact, expanded, collapsed, and history states on
an API 35 emulator; build, lint, and unit tests cover the Android package.
Emulator UI checks do not establish physical-device touch-through behavior or
provider translation.
