# Formal candidate follow-up

## Compact indicator preference

The `b9d124c220cb90e43ef98618d13e247d50de03b4` settings preview and
subtitle overlay passed the selected pulse style to `PulseRing`. The compact
control capsule omitted it, so both sound styles rendered as the default ring
there. Forward the existing preference without changing animation, geometry,
defaults, storage, or credential behavior.

The focused regression fails before the fix (`classic` instead of `syllable`)
and checks all three styles in compact and expanded control states after it.
The frontend suite passes 250 tests, typecheck/production build succeeds, and
lint has zero errors plus the existing SoftwareUpdate refresh warning.

Actual Mac headless Chromium component checks also cover all seven phases,
CSS clock identity through working phases, settling and frozen clocks for
paused/error/idle, resuming the same clocks, explicit off, default system
reduced motion, independent pulse/subtitle preferences, and three rounds of
settings category navigation. These are synthetic browser component checks,
not native bundle, actual audio, or provider verification.

## Formal authentication observation

The release-shaped Mac candidate built from exact `b9d124c` used the installed
formal Bundle ID and certificate. Strict signature and complete designated
requirement comparisons passed. Binary SHA256:

`e0c0f52b421122f7bc3578a5c753365101ff191996d05fe07c084b452c26a335`

During the user-approved temporary replacement, the first normal launch
requested login-Keychain authentication for
`app.yuxino.mimi.credentials.profiles`. No authentication was automated, no
key/ACL/TCC was changed, and no paid session was started. The complete old app
was restored and strictly verified; non-secret configuration stayed unchanged.
Credential reading and two cold restarts remain unverified. This is an actual
formal-candidate observation, not proof of credential loss or the precise ACL
of the user's existing item.

## Controlled next step

1. Coordinate one foreground owner and a new bounded normal-app test window.
   Establish the requester for any current system prompt before the user
   authenticates; a leftover prompt must not be attributed to a new package.
2. Freeze the exact candidate source, binary, path, signature and complete DR.
   Do not rebuild between authentication and cold restarts. Back up the old
   bundle and non-secret configuration before an explicitly coordinated
   replacement.
3. Let the user handle the OS authentication UI. Do not automate password,
   Allow/Always Allow, save a key, or alter ACL/TCC. More than one existing
   profile/item can need separate OS authorization.
4. Observe only credential status, normally quit, and cold-start the same
   binary twice. Check configuration and unrelated menu/settings operations
   without starting capture or a paid provider. Repeated prompts or failed
   status stop the test and retain the rollback path.
5. A successful user authorization and these restarts validate this exact
   upgrade/binary only. They do not promise every future upgrade is prompt-free.
   A stable Developer ID distribution identity is a separate deliberate
   migration after account approval and must receive its own legacy-item and
   capture-permission acceptance; it is not silently substituted here.

Issue #83 remains open. Credential-free UI checks continue independently and
must not be described as normal credential or actual subtitle-service passes.
