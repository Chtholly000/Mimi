# Persistent recognition error feedback

An unsupported source language from a custom Audio3 service was reduced to an
unknown task failure. The overlay could hide its reason behind existing subtitle
content or a collapsed/immersive presentation; other controls primarily offered
retry. This left a configuration failure looking like a transient connection fault.

## Decision

- Whitelist the exact Audio3 `UNSUPPORTED_LANGUAGE` code and map it to a fixed,
  localized explanation. Never render provider error bodies. Connection checks
  expose the typed `unsupportedLanguage` reason; content-free diagnostics retain
  the configuration category and allowlisted code.
- Map Audio3's exact fixed transport/timeout labels to localized speech-connection
  guidance, including checking that a local service is started. These labels survive
  the recognition/translation adapter unchanged; unknown native errors remain hidden.
  Preserve retry without claiming a specific TCP, TLS or proxy cause.
- Treat fixed authentication/unsupported-language and setup request errors as
  requiring user action, including during an existing reconnect loop. Runtime
  generic CLIENT_ERROR remains retryable because it may represent queue overload.
  Explicit LOCAL_ASR_OVERLOADED and LOCAL_ASR_TIMEOUT codes get fixed localized
  recovery advice and retain retry, as do transport, timeout and service errors. Do not infer language support
  from provider names or restrict every custom service to one model's languages.
- A successful source/profile/speech-route change, or an explicit successful save
  of the active service, retires its observed configuration error to idle. Compare
  the original error and lifecycle epoch under the settings guard, retain current
  subtitles, and never start capture automatically. Failed saves, display changes,
  inactive-profile edits and newer session errors do not retire the failure.
- Use a shared normal-size session-error component in settings, tray and overlay
  controls, with an explicit speech-settings action. A configuration error's main
  action opens settings; transient errors retain manual retry. Keep current
  subtitle content visible alongside the failure.
- An errored overlay temporarily uses its existing expanded frame, with a minimum
  280-pixel height, and restores background and click interaction. Native geometry
  applies on the main loop, invalidates old resize transactions, and rejects
  persistence of this temporary frame. Stored collapsed, immersive, locked and
  expanded-size preferences remain unchanged. Recovery restores those preferences.
  Explicit dragging remains available during the override and updates position only,
  retaining the normal saved width and height. Automatic error expansion is never
  promoted to user geometry. Reconcile a pending drag before recovery so a quick
  settings correction cannot snap the window back. Resizing, collapse, entering
  immersive/locked mode and automatic Space following remain suspended while the
  error needs to be readable. Top actions use the same temporary unlocked state as
  the native window; saved reading-mode preferences remain unchanged.

## Scope and verification

Desktop Audio3 decoding, session recovery and native presentation are affected.
Android currently uses the separate DashScope realtime `session.update` adapter,
not Audio3 `run-task`/`task-failed`; no shared subtitle or text-translation contract
changes. Tests cover safe code decoding, loopback setup rejection, recovery policy,
three-language feedback across sibling surfaces, and temporary native geometry.
The initial canonical repository check passed: 1095 desktop Rust tests (2 ignored),
1474 frontend tests, shared-core/JNI crate checks, strict lint and production build.
The follow-up transport-label mapping passed 75 focused frontend tests, typecheck
and lint. Signed macOS acceptance confirmed unsupported-language feedback, settings
navigation, idle recovery and preserved geometry in the local QA combination. The
transport-label fix still needs native replay; pre-existing collapsed/immersive/content
states remain unverified natively. See the integration run ledger for exact revisions
and evidence boundaries.
