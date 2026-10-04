# Avoid authorizing every saved provider at startup

The local September 30 fix dd1295a exists on an older UI branch but is absent
from this current feature branch. Settings snapshots still load every profile's
secret, so a rebuild can produce one authorization prompt for every saved key.
Port its metadata-only approach to the current profile and custom-pipeline model.

On macOS, the active profile keeps existing validated and cached reads. Unselected
profiles query the exact service/account in the User keychain for attributes
only. For custom speech profiles both speech and independent text slots use
presence; FollowService does not require a text item. Already cached access
errors and missing results take precedence. Unchecked saved-item badges do not
certify credential validity or the selected translation route; selection/use,
reveal and explicit diagnostics retain full validation. Legacy discovery checks
only metadata and respects the migration tombstone; migration stays on use.

The dev hybrid store must delegate ordinary presence checks to its OS store;
otherwise its default contains implementation would load each ordinary key.
UI-only and non-macOS behavior remain unchanged. security-framework is already
in the locked dependency graph and is referenced directly only for this query.
No new service, plaintext credential mode, changed account, recreated credential,
ACL widening or certificate change is involved.

Regression coverage uses the real settings snapshot with three saved providers,
repeated snapshots and profile selection. Separate custom speech/text slots,
legacy presence and cached authorization failure are included. The native formal
install must compare complete signing requirements, preserve its configuration,
and be tested separately from mocks. Current fixed self-signing has no Apple
Team ID and does not guarantee password-free Keychain reads after rebuilds.
