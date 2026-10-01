# Session and immersive display controls

The user screenshot showed Live Subtitles at the bottom of the sidebar while
Immersive Mode was deep in the subtitle page. Move both into one top content
card, reachable from each settings category. Keep diagnostics in the sidebar.
Show the verified platform shortcut beside each control instead of explaining
Mac/Windows/Linux bindings in one long paragraph. Unverified bindings are not
advertised; Linux desktop shortcut setup remains available when required.

The session switch retains the existing coordinator, credential gating,
status, errors, and Configure Service action. The layout never starts capture
or changes settings by mounting. Entering immersive requires an active session
without a pending transition; inactive text simply asks to enable Live
Subtitles first. An already enabled immersive preference can always be turned
off, including after stopping, during transitions, or with unavailable keys.
Chinese/English/Japanese help keeps the exit route here or in the tray.

Verification: 251 frontend tests, typecheck/production build, lint zero errors
with the existing SoftwareUpdate refresh warning. Actual Mac headless Chromium
uses isolated synthetic browser store data: 61 assertions across zh/en/ja and
760/520 px widths, DPR2. Checks include no changes on mount, both controls in
the top card, disabled inactive immersion, no horizontal overflow, deliberate
synthetic start/immersive/stop/exit, and configuration navigation when keys are
missing. These are frontend component checks, not native/provider/audio passes.

Before captures use exact 8e4432e SettingsView, i18n and settings CSS with
imports rebased to shared supporting modules. The old page is scrolled to the
immersive row; after shows the new card at the top. Both share viewport/theme/
synthetic preferences. 12 HD screenshots cover both widths and three languages.
Visual confirmation and a new exact native bundle remain pending; no local Rust
build, install, paid provider, real credential access, ACL/TCC change or release
was performed for this adjustment. Issue #83 is tracked separately.
