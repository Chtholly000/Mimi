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
  Manual dragging/resizing and Space following are suspended during this override.

## Scope and verification

Desktop Audio3 decoding, session recovery and native presentation are affected.
Android currently uses the separate DashScope realtime `session.update` adapter,
not Audio3 `run-task`/`task-failed`; no shared subtitle or text-translation contract
changes. Tests cover safe code decoding, loopback setup rejection, recovery policy,
three-language feedback across sibling surfaces, and temporary native geometry.
The canonical repository check passed: 1095 desktop Rust tests (2 ignored),
1474 frontend tests, shared-core/JNI crate checks, strict lint and production build. Signed native acceptance is a separate
step: verify normal/content/collapsed/immersive/locked errors and restored geometry,
including Open speech settings and a temporary network failure's retry action.
