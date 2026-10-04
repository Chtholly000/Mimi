# Settings and profile selection without authorizing saved keys

The September 30 inactive-profile fix dd1295a was absent from this feature
branch and was first ported in ffa9fd6. Native user feedback then confirmed that
selecting another saved profile still requested a Keychain password: emitting
the settings snapshot validated the newly active profile's secret. Selection
and saved-item badges do not require secret bytes, even for the active profile.

On macOS all profile states in settings snapshots use exact service/account
attribute-only presence queries in the User keychain. Cached results, including
access errors and invalid/empty values, still take precedence. Custom speech and
independent text slots both use presence; FollowService needs no text item.
Legacy discovery respects its tombstone and uses metadata only; migration stays
on actual credential use. Badges establish presence, not provider authentication
or credential validity. Listening, reveal, saving and explicit diagnostics keep
their existing validation and OS authorization; this does not move credentials
out of the keychain or bypass its access control. UI-only/non-macOS semantics
remain unchanged. The dev hybrid delegates ordinary-profile presence to the OS.

Regression uses real settings snapshots while repeatedly selecting three saved
providers and the custom speech/text pipeline, asserting zero secret reads.
Actual listening/probe configuration reads and validates each slot once. Legacy
presence and cached authorization failures stay covered.

A native disposable three-item experiment on this Mac disabled Keychain user
interaction for every operation. Fixed self-signed build A read its own items;
changed build B with the same designated requirement failed all three reads
with -25293. Repeating with the existing Apple Development identity succeeded
for all three changed-build reads with status0. Each pair had the same complete
requirement and a changed CDHash. Original owner builds deleted all test items.
No real provider credentials, item ACLs, keychain trust or installed identity
were changed. This proves newly created test-item continuity on this Mac, not
migration of existing Mimi items or capture grants. An Apple signing migration
must be explicit and should be verified across installed Mimi rebuilds; public
Developer ID distribution is a separate requirement from local development.
