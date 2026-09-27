# Intel macOS preview

## Scope

Produce an independently downloadable Intel QA package for a user who requested
Intel Mac support. Keep macOS 13 as the minimum version and retain the existing
system-audio-only capture, cloud providers, privacy defaults and Keychain storage.
An actual Intel Mac must validate capture and permissions before formal support
or an Intel updater channel is announced.

## Approach

Allow the existing local packaging command to select `x86_64-apple-darwin` or
`aarch64-apple-darwin` explicitly. Without an argument its native build behavior
is unchanged. Reuse stable signing and reject unexpected binary architectures.
Keep target output directories separate. Do not modify the installed app,
published releases, version, or updater manifest for this preview.

A separate Intel DMG limits download size and avoids replacing the working ARM
release. A universal package would increase downloads and require validation of
both slices; deferring all work until hardware is available would prevent the
requesting user from testing.

## Build and acceptance

Install the Rust `x86_64-apple-darwin` target, then on the signing Mac run:

```sh
./scripts/package-app.sh --target x86_64-apple-darwin
```

The DMG is under `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/`.
Run the repository checks and verify the app signature, architecture, minimum
system version, and matching app inside the DMG. Packaging is not proof of
Intel hardware compatibility. Rosetta execution, if tested, is separate evidence.

On an Intel Mac running macOS 13 or later, verify installation/opening, normal
Gatekeeper approval, system-audio permission, provider-key storage/readback,
live translated subtitles, pause/resume/stop, and overlay/full-screen behavior.
Keep diagnostics content-free. The self-signed preview is not Apple-notarized
and can require normal OS approval. Its in-app updater has no Intel platform
entry yet; testers replace previews manually. Formal release integration waits
for that hardware feedback.
