# Linux credential recovery

A desktop session can have a working D-Bus connection without a Secret Service
provider. Treating this as an unlock prompt sends the user to a nonexistent
recovery action. An installed wallet executable also does not establish that
`org.freedesktop.secrets` is available in the current session.

Retain the existing coarse credential badge (`unavailable`) while exposing only
fixed diagnostic categories and public error labels:

| Backend result | Diagnostic | Public error |
| --- | --- | --- |
| Cannot establish an encrypted Secret Service session | `serviceUnavailable` | `credential_service_unavailable` |
| Linux backend reports `NoStorageAccess` | `accessDenied` | `credential_store_access_denied` |
| Other storage failure | `unavailable` | `credential_store_unavailable` |
| Accessible store with no entry | `missing` | Existing missing-credential behavior |

Initialization failure does not prove the provider is uninstalled: connection,
session negotiation and provider failures share this category. Guidance asks
the user to ensure a compatible provider is installed and enabled in the
current desktop session. `NoStorageAccess` includes a locked store, dismissed
prompt or missing result, so guidance covers unlocking and denied access.
Unknown operation failures remain generic rather than claiming a locked store.

Preserve fresh encrypted backend sessions, selected-profile retry behavior,
item identity and save verification. User-entered values stay in the editor
after failed saves or connection rechecks. No host keyring configuration,
permission changes, plaintext fallback, raw backend error serialization, or
provider authentication request is added.

Regression coverage uses synthetic values and fixed labels. The private D-Bus
recovery test begins with no activatable service, verifies failed save and the
service-unavailable diagnostic, starts an isolated provider, then verifies
missing/present/deleted states in the same process. Unit tests cover denied
access, unknown errors, public-label propagation and content-free support
codes; frontend tests cover localized guidance and editor retention.
