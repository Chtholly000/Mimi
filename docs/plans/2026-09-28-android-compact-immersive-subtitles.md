# Android compact and immersive subtitles

The Android port keeps Mimi's desktop visual language: grayscale surfaces, the
existing character artwork, one primary session action, and a small live
subtitle overlay. The supplied mobile reference informs the overlay's reading
hierarchy, not a full-screen transcript or a toolbar over the video. History
remains opt-in and bounded.

Normal mode shows the current source and translation in a compact translucent
card. Its background opacity remains adjustable, and users can drag it
vertically. New installations use a readable 65% dark background; an existing
saved value still wins. The home and settings previews use the same mode choice.

An appearance switch enables immersive mode for the next session. The overlay
then has no background, hides history, uses a text shadow for contrast, and is
not touchable. Android 12 and newer reject touches passing through a fully
opaque untrusted overlay, so the immersive window's opacity is capped at 0.8.
Because the text cannot receive gestures, the app and foreground notification
remain the controls for stopping or changing the mode. The ordinary card stays
touchable for dragging.

Mode and appearance settings save separately from provider credentials. Preview
requires no service account, capture permission, or network session. Verify
the new switch and its restored preference on an API 35 emulator in light and
dark themes; build, lint, and unit tests cover the Android package. Emulator UI
checks do not establish physical-device touch-through behavior or provider
translation.
