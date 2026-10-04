# PR89 integration review

Source: LLLin000/mimi PR89, independently re-fetched head `2700f6dd78dbe2d071fbdcb26d1b3eabe53f0c21`. The three original commits are preserved in merge `7f16267` on the integration branch. This is a candidate, not a main merge or release.

## Code/body differences corrected

The source body described automatic communications→media→console audible selection for the empty default, but the exact source only ran FollowAudible for `follow:audible`; empty still followed CPAL console, ranked roles were not passed to the policy, and the picker still exposed the extra experimental choices. Census returned raw IMMDevice ids whereas its selected-id resolver compared CPAL's persisted display ids; that could fall back to the wrong endpoint.

Integration repairs those paths without duplicating capture. The existing pure state machine gains ordered role preference. It preserves an audible binding unless a higher role is audible; same/lower roles cannot steal by loudness. The initial integration retained the two-decision dwell for all moves; the 2026-10-01 upstream update below supersedes that policy only for a strictly higher audible role. Silence releases the policy binding; resolution falls back through communications, media, console, then an available concrete render endpoint. A missing manual endpoint still errors, rather than silently choosing another. Legacy role/audible values remain supported and visible only when selected; normal picker stays Follow system + endpoints.

Raw census ids now compare CPAL backend ids. IMMDevice::GetId allocations are copied and freed; the friendly-name PROPVARIANT is type checked and cleared. UI-only audio_census returns empty without enumerating real devices/processes. No census data is added to support diagnostics. macOS/Linux census remains honestly empty, with their capture behavior unchanged.

Source contracts: [IMMDevice::GetId](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdevice-getid), [IPropertyStore::GetValue](https://learn.microsoft.com/en-us/windows/win32/api/propsys/nf-propsys-ipropertystore-getvalue). API signatures/type layout also checked against the local windows0.61.3 generated bindings.

The shared settings merge preserves both Windows source and existing pulse style/animation fields. This was the sole merge conflict and was resolved field by field.

## Verification

Pure audio-source regression: 11 tests, including role promotion over active media after dwell, no loudness stealing, non-role fallback, silence/reappearance, nonfinite levels, manual unavailability, and generation stop. Frontend: 16 targeted tests (source classification, optimistic source merge, existing pulse choices), tsc and changed-file eslint passed. Full exact integration cross-platform CI pending at commit time. New Windows id-match test can run with endpoints if available; headless CI is explicitly not physical-device coverage.

Contributor's Windows11/paid provider observations remain self-reported source-PR evidence, not this integration's independent real-session validation. Teams, role routing on physical hardware, Bluetooth A2DP/HFP, unplug/replug and paid subtitles are unverified. Event-driven following, capture/session-lifecycle decoupling, per-app capture and mac/Linux census are not added to this integration.


## 2026-10-01 upstream update

Re-read source PR89 at `973f0b7974af908312744cac8557b3476c7e00e0`, authored by LLLin000. Its new commit is merged with contributor ancestry retained; the five-file delta overlaps the existing `6239848` automatic-default correction. This update does not change the session/immersive controls introduced at `6b53182385ce06f03ddcbfa44b0b65f5742cc331`.

Port the new immediate promotion: an audible communications endpoint takes over media/console, and any audible role endpoint outranks a non-role binding without waiting for the dwell. Same/lower roles do not steal a still-audible binding. Demotion or non-role loudness changes retain the original dwell and watermarks. Finite-level guards remain, including the bound endpoint. The upstream smart-default helper is retained with the integration's raw backend-id resolver, role-chain fallback, final concrete-render fallback, and COM allocation cleanup; raw census ids cannot go through the persisted CPAL display-id comparison.

The normal picker already contains Follow system plus concrete outputs, matching the upstream simplification. Preserve conditional labels for an already persisted `role:communications`, `role:multimedia`, `role:console`, or `follow:audible` so an upgrade does not expose a raw value or silently rewrite a user's choice. Add real component regressions for the normal list, three-language legacy labels, manual-device removal, and active-session lock.

Focused pure Rust source tests cover immediate promotion, no loudness stealing, a non-role-to-role transition, invalid/infinite samples, demotion dwell, silence, manual selection failure, and generation invalidation. Standalone Rust tests do not compile the Windows WASAPI layer; the exact integration CI must validate that layer. Windows physical devices, Teams, Bluetooth and paid provider subtitle flow remain untested here. No native app launch, credentials, audio capture, local Rust dependency rebuild or packaging is needed for this update.

Local validation: all 12 standalone audio-source Rust tests passed; all 11 targeted frontend tests (four files, including the session/immersive controls) passed; TypeScript build-mode checking, changed-file ESLint, Rust formatting and diff whitespace checks passed. Exact merged cross-platform CI remains pending until pushed.
