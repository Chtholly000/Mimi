# Android release packaging

The previous Android release workflow built assembleDebug, kept the internal
version at 0.1.0, and raced the immutable desktop release to upload an attachment.
Renaming that artifact does not make it a release build.

Android owns android/version.properties; increment versionCode on each public
update. CI tests and lints both variants and builds the unsigned release without
signing secrets. android/sign-release.sh accepts only the expected compiled
package/version with debugging disabled, aligns it, signs with an existing key
and verifies the pinned certificate and alignment before exposing the output.
It never generates a key or falls back to debug signing.

Publishing uses independent android-v* tags or a manual main branch run. All
verified assets are uploaded into a draft before publishing, so immutable
releases are complete when locked. Desktop tags, assets and latest-release
selection are unchanged. Existing releases fail closed.

The first release requires a backed-up Android keystore, four repository secrets
documented in android/README.md, and its public certificate SHA-256 variable.
Missing credentials fail before building. Never commit or log private signing
material, or include it in build artifacts. All future APKs must use the same
identity. Debug installations require an explicit uninstall; the bilingual
release notes explain the resulting settings/credential loss.
