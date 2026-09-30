# PR89 integration review

Source: LLLin000/mimi PR89, independently re-fetched head `2700f6dd78dbe2d071fbdcb26d1b3eabe53f0c21`. The three original commits are preserved in merge `7f16267` on the integration branch. This is a candidate, not a main merge or release.

## Code/body differences corrected

The source body described automatic communications→media→console audible selection for the empty default, but the exact source only ran FollowAudible for `follow:audible`; empty still followed CPAL console, ranked roles were not passed to the policy, and the picker still exposed the extra experimental choices. Census returned raw IMMDevice ids whereas its selected-id resolver compared CPAL's persisted display ids; that could fall back to the wrong endpoint.

Integration repairs those paths without duplicating capture. The existing pure state machine gains ordered role preference. It preserves an audible binding unless a higher role is audible; same/lower roles cannot steal by loudness. All moves retain the two-decision dwell, so this does not promise an instantaneous meeting takeover. Silence releases the policy binding; resolution falls back through communications, media, console, then an available concrete render endpoint. A missing manual endpoint still errors, rather than silently choosing another. Legacy role/audible values remain supported and visible only when selected; normal picker stays Follow system + endpoints.

Raw census ids now compare CPAL backend ids. IMMDevice::GetId allocations are copied and freed; the friendly-name PROPVARIANT is type checked and cleared. UI-only audio_census returns empty without enumerating real devices/processes. No census data is added to support diagnostics. macOS/Linux census remains honestly empty, with their capture behavior unchanged.

Source contracts: [IMMDevice::GetId](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdevice-getid), [IPropertyStore::GetValue](https://learn.microsoft.com/en-us/windows/win32/api/propsys/nf-propsys-ipropertystore-getvalue). API signatures/type layout also checked against the local windows0.61.3 generated bindings.

The shared settings merge preserves both Windows source and existing pulse style/animation fields. This was the sole merge conflict and was resolved field by field.

## Verification

Pure audio-source regression: 11 tests, including role promotion over active media after dwell, no loudness stealing, non-role fallback, silence/reappearance, nonfinite levels, manual unavailability, and generation stop. Frontend: 16 targeted tests (source classification, optimistic source merge, existing pulse choices), tsc and changed-file eslint passed. Full exact integration cross-platform CI pending at commit time. New Windows id-match test can run with endpoints if available; headless CI is explicitly not physical-device coverage.

Contributor's Windows11/paid provider observations remain self-reported source-PR evidence, not this integration's independent real-session validation. Teams, role routing on physical hardware, Bluetooth A2DP/HFP, unplug/replug and paid subtitles are unverified. Event-driven following, capture/session-lifecycle decoupling, per-app capture and mac/Linux census are not added to this integration.
