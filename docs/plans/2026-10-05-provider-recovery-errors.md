# Provider authentication and safe recovery errors

The Gemini, Azure OpenAI, Tencent, Baidu, Volcano and xAI clients reduced an HTTP
401/403 WebSocket handshake rejection to a generic transport failure. Connection
diagnostics therefore lost the actionable authentication category, and session
recovery could present a configuration problem as a connection retry. The frontend
also lacked mappings for several fixed client errors, leaving safe, actionable
failures on the generic fallback. Adding these mappings must not accept arbitrary
provider text because it contains a familiar fragment.

## Decision

- Preserve handshake authentication rejection in all six clients with a typed
  `AuthenticationFailed` variant. Reuse the existing status classifier; only HTTP
  401/403 take this path. Its display label is exactly
  `credential_authentication_failed`, matching the established OpenAI and Alibaba
  transport behavior.
- Map those variants to `ConnectionCheckReason::AuthenticationRejected`. Retain
  the existing settings-led recovery for authentication errors. Do not claim a
  rejected credential is necessarily mistyped: authorization can also depend on
  service activation, model access or account permissions.
- Keep timeouts, HTTP 429/500, connection failures and setup-protocol rejection on
  their existing paths. Do not broaden authentication matching to generic message
  substrings or expose handshake response bodies.
- Extend `connectionDiagnostics.ts` with exact safe labels for Alibaba Live,
  OpenAI, Gemini, Azure, xAI, Tencent, Baidu and Volcano: transport/not-connected,
  health/connect/setup timeout, setup/session rejection, missing credentials and
  unsupported language. Azure's fixed endpoint/deployment labels lead to
  configuration guidance. Fixed protocol failures and unexpected session endings
  use the existing translation-unavailable/reconnect message without guessing a
  lower-level cause.
- Parse Baidu's setup-code label only as its complete fixed template with a
  canonical signed 64-bit integer. The integer alone is safe to retain; no more
  specific provider-code meaning is asserted. Unknown or malformed labels,
  including extra prefixes/suffixes, use the generic safe fallback. Localized UI
  text remains owned by Mimi; provider bodies, URLs and credentials must never
  become visible error prose.
- Keep the shared settings, tray, overlay and overlay-control error presentation
  consistent. Exact authentication, missing-credential, invalid-configuration and
  unsupported-language labels open service settings and hide blind retry. Timeout
  and unclassified rejection errors, including Baidu's numeric setup codes, retain
  retry. The compact overlay must not lose the settings recovery entry.
- Classify the exact `baidu_unexpected_session_end` code and its fixed native
  message in content-free support diagnostics; private suffixes remain unknown.
  This closes a metadata gap and does not establish why a real Baidu session ended.
- Apply the same HTTP 401/403 classifier in Android's independent streaming,
  OpenAI and DashScope engines. `MimiService` preserves the exact safe label for a
  Chinese/English/Japanese settings-led credential/permission message; other
  errors retain generic feedback. Shared `translation-contracts.json` handshake
  fixtures define 401/403 versus transport behavior for Rust and Kotlin tests.
  No reconnect, wire-protocol, shared reducer or JNI behavior is changed.
- Preserve transcript pairing, provider prompts, language catalogs, capture and
  streaming-generation ownership.

## Verification boundary

The focused Rust handshake run passed 8 tests after the shared fixture update.
Six tests exercise each real client
connect path against loopback HTTP 401, 403, 429, 500 and a connection closed without
an HTTP response; the remaining cases cover classification. They assert the fixed
label, readiness remaining false and no response-body leakage. They use synthetic
credentials and do not contact cloud services.

Support-diagnostic Rust tests passed 13 cases, including exact Baidu code/message
classification and rejection of private suffixes. The latest frontend focused run
passed 141 tests for diagnostics, shared feedback and tray behavior, including
three-language recovery actions, settings navigation, strict label rejection and
Baidu integer bounds. ESLint, TypeScript and diff checks passed for those changes.
A separate 191-test baseline covered overlay projection, timeline scrolling and
streaming, snapshots, bootstrap and shared error feedback.

Three focused Android regression cases were added. The attempted
`./gradlew --offline --no-daemon testDebugUnitTest` stopped before running tests
with `Unable to locate a Java Runtime`; no JDK/Android SDK was installed for this
attempt. XML and shared JSON parsing passed, but Android unit tests, Gradle/JNI
validation and device acceptance remain pending. No failing Android test assertion
was observed.

The [native observations](../development/provider-regression-matrix.md) used
`d58f4bad`, before these patches: Alibaba, Gemini and Apple Speech + DeepL produced
fresh ASR/MT through the final sample sentence after resume/replay. Baidu displayed
six confirmed groups, then a generic failure after about 73.7 seconds connected;
its cause remains unproven. These were not full multiwindow snapshot traces.
The final desktop canonical check and patched-build native rerun remain pending;
loopback, frontend and pre-patch native results do not establish acceptance of the
patched application or Android behavior.
