# Application picker icons and floating-panel search

The user requested application icons in the floating panel's audio picker and
reported that its search field would not accept typing. Keep the shared picker
consistent in settings and the floating panel, without changing capture routing,
selected targets or recording permissions.

## Local icons

Add optional `iconDataUrl` presentation metadata to `AudioApplication`. On macOS,
use the existing NSWorkspace application list and NSRunningApplication icon. Do
not enumerate screen contents or use ScreenCaptureKit for names or icons. Keep
AppKit objects on the application's main thread and preserve the current graphics
context even if an individual icon fails to render.

Sort, deduplicate and retain the existing maximum of 512 choices before rendering
icons. Redraw each icon into a fresh 32×32 RGBA bitmap and encode PNG with the
already available AppKit bindings and base64 dependency. Limit one PNG to 8 KiB
and all encoded icon URLs in one snapshot to 1 MiB. A failed, missing or oversized
icon leaves a selectable text row with the shared fallback icon. Windows returns
no native icon in this change; Linux retains its unsupported application picker.

There is no new disk storage, persistent icon cache, dependency, network request
or permission. The frontend replaces its bounded application snapshot. Icons,
application names and identifiers stay out of diagnostics, recordings and saved
capture preferences; preferences still store only the existing selected target.

## Floating-panel typing

The reported focus failure is specific to the macOS floating NSPanel; settings
search already accepts input. Let a user interaction make the control panel key
by disabling `becomesKeyOnlyIfNeeded` for that panel. Preserve its nonactivating
style and `canBecomeMain = false`, and do not focus it just because it opens.
Do not change the subtitle overlay's keyboard behavior or rewrite the shared
search component to compensate for the native panel restriction.

## Verification

Cover optional camelCase serialization, missing icons, per-icon and snapshot byte
limits, valid small PNG output and restored graphics context. Keep the native
class policy check independent from opening a real window. The final signed-app
check must inspect icons and type in both settings and floating-panel search,
including empty results, Escape, closing/reopening and normal subtitle controls.
Offscreen image and policy tests do not replace that native interaction check.
