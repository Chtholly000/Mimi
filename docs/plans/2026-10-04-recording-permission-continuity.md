# Recording permission continuity in release and development builds

The user reported the macOS Screen & System Audio Recording consent dialog when
starting subtitles with the shortcut, after a local certificate migration. The
credential migration is complete and independent. Extend this followup to the
recording permission path in both canonical apps, while keeping the branch
unmerged and preserving existing configuration and credentials.

## Established causes and boundaries

The installed release and development bundles currently use different designated
requirements. A prior explicit user instruction requests returning the release
app to its original fixed local certificate. Restore that exact existing identity
for this local installation; never create a replacement certificate or weaken
system consent. A visible enabled Settings entry alone does not establish that
it matches the current binary. The shortcut uses the regular session start path;
first capture still requires a valid macOS grant.

Two code paths can request consent unnecessarily. Application enumeration uses
ScreenCaptureKit even though it only needs running application names and bundle
identifiers. Use NSWorkspace for that list, keeping existing filtering and stable
sorting. Only actual capture should access ScreenCaptureKit. Native stream-stop
errors currently discard permission/user-stop reasons; reconnect then retries
permission denial. Preserve those reasons and stop recovery immediately on
non-retryable capture permission or user-stop errors. Keep transient failures
eligible for bounded recovery and preserve the final relevant error.

Development launch must resolve its own optional signing pin instead of the
release pin. Keep explicit overrides, unique fixed-certificate fallback, and
full designated-requirement verification before installation. Missing or invalid
pinned identities fail closed. Normal updates must retain each installed app's
identity; intentional migration is separate from routine packaging.

## Verification and recovery

Add focused regressions for enumeration without capture access, native terminal
error classification, permission denial during recovery, and separate signing
pin resolution. Run the canonical checks and verify both signed bundles. Test
application listing, shortcut start, stop/restart and same-identity replacement
from the canonical paths; report actual capture separately from mocks/UI-only
mode. Use only previously authorized public test audio if provider validation is
needed; do not retain or log user audio/subtitles.

The README FAQ links concise recovery steps for a stale grant: normally quit the
affected app, remove only its old recording entry, add its matching canonical
application and enable it, then reopen and test. Development and release grants
remain separate. Do not reset global TCC, edit the permission database, grant
unrelated access, or manipulate Keychain to repair recording permission.

References: [Apple recording access controls](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac)
and [running applications](https://developer.apple.com/documentation/appkit/nsworkspace/runningapplications).
