# Desktop subtitle color

Port the five Android subtitle color presets to desktop: white (default), teal,
yellow, green, and pink, using the same RGB values and display order.

Store the selected preset in Preferences and expose it through the existing
settings snapshot/draft contract. Missing preferences default to white. Color
changes are presentation-only and remain available during an active session;
they do not change provider configuration or restart audio/translation.

Use the selected color for translation and original-only subtitles in both card
and immersive layouts. Bilingual source lines keep neutral white and their
existing opacity. Preserve draft and history fading, timestamps, and shadows.
The settings preview uses a neutral dark surface to keep all presets visible in
both application themes. Labels are localized in Chinese, English, and Japanese.

Verify legacy defaults, palette serialization, persistent reload without provider
changes, optimistic settings updates, and actual Timeline rendering in both
layouts. Run the canonical repository checks and the signed UI-only development
app before publishing.
