# Speech language parameters and configuration guidance

## Problem and chosen scope

Users cannot tell whether a language choice configures a real API parameter, constrains recognition, or adds a capability to a third-party model. A generic “use Auto for mixed languages” tooltip is wrong for explicit-source services and for arbitrary custom endpoints. The custom catalog is also artificially fixed at four languages, while xAI input hints and documented OpenAI/Gemini outputs are missing.

Keep the existing profile, preference and protocol boundaries. Use provider-specific help shared by Settings, tray and floating controls; show unknown custom model support as a visible, normal-size constraint. Auto on a custom route is labeled **Service default**, because the encoder omits the parameter. No endpoint discovery, capability probe, model download or credential migration is added. When enabling text translation normalizes an unsupported explicit source back to Service default, one transient notice names the actual before/after languages. It waits for both successful completion and the applied settings event, in either order, and cannot reappear after blur or unmount. The tray has no translation toggle and displays the resulting shared preference.

## Request and catalog changes

- Custom ASR exposes every currently representable explicit source code in recognition-only mode (30 plus Service default). These are configurable protocol values, not supported model languages. DashScope uses `language_hints`; OpenAI uses `language`, or `languages` for `gpt-live-transcribe` names. Names determine wire shape, never endpoint trust. An independent text route still narrows explicit sources to its implemented four-language mapping; unknown reported languages under Auto remain service-detected for DeepL/DeepLX (see the [detected-source design](2026-10-05-detected-text-source.md)).
- xAI adds a source preference that reaches `audio.input.transcription.language_hint` on the actual WebSocket setup. Only 11 unambiguous documented codes represented by Mimi are accepted; Auto omits the hint. Regional Spanish, Portuguese and Arabic defaults are not invented. Existing translation instructions remain verbatim.
- OpenAI dedicated realtime translation accepts its documented 13 target codes. Gemini uses its own independent 30-entry target catalog within Mimi's represented language set, with `zh-Hans`, `zh-Hant` and `fil` mappings. Generic Portuguese remains unavailable because the service documents regional variants.
- Rust, TypeScript and Android catalogs consume the same synthetic expectations in `shared/translation-contracts.json`; Rust and Android tests exercise actual encoders. Android expanded labels use system locale display names, retaining existing translations for the original entries.

Alternatives rejected: displaying one universal model-support list would misrepresent custom services; adding user-editable arbitrary JSON would expose unsupported protocol combinations; dynamically querying private services is neither a common protocol capability nor needed for this request.

## Verification and remaining boundaries

Cover omission versus hint, unsupported regional choices, target mappings, custom recognition-only versus translated-route intersections, actual xAI loopback setup, localized help and all sibling controls. Run the canonical repository check and Android shared-contract CI. No live cloud request or native capture is needed to verify field serialization. Signed native UI acceptance remains a separate check coordinated by the main task; this branch does not launch or install a dev app.

The [setup guide and audit matrix](../speech-language-setup.md) state the exact implemented subsets and unresolved provider gaps. This change does not claim all providers expose their complete official language catalogs.
