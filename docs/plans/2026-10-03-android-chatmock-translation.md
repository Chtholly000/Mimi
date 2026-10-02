# Android ChatMock translation (#90)

## Scope and decision

ChatMock exposes text Chat Completions, not Mimi's realtime audio WebSocket protocol.
Add an optional, independent text translation stage to the existing Alibaba service:
system playback audio → DashScope realtime ASR → ChatMock/OpenAI-compatible HTTP → subtitles.
Existing integrated services keep their defaults. This PR does not merge or release automatically.

A URL override alone cannot work. Overriding translations for every existing speech service
would still pay for their integrated translations and imply untested recognition capabilities.
The initial pairing therefore uses Alibaba's transcription-only model explicitly.

## Configuration and UI

Alibaba's editor separates speech credentials from text translation. The text stage defaults
to off. Address, model and optional bearer key are independent, encrypted, and written only
by Save and use with the speech configuration. A changed destination cannot reuse an old key.
Back/cancel never saves a draft. Nonessential compatibility, address and storage guidance lives
in help dialogs reached by small accessible help icons (also hover/long-press tooltip).
No new persistent small-print paragraphs. A check sends a fixed non-private translation
request and reports its elapsed milliseconds beside the action; edits cancel stale checks.
Chinese, English and Japanese resources remain aligned.

## Transport and session rules

Accept a base URL ending in /v1 or the complete /chat/completions URL. HTTPS is the normal
transport. Only localhost, 127.0.0.1, ::1 and the emulator host 10.0.2.2 may use HTTP, with explicit
unencrypted-connection opt-in. Android network-security-config matches that allowlist and
disables all other cleartext traffic. LAN and public endpoints require HTTPS. No URL
credentials, query tokens, fragments or redirects. Existing speech transports remain secure. ChatMock itself is operated
and authenticated by the user; Mimi never handles ChatGPT login credentials.

Use non-streaming Chat Completions with a bounded response, finite timeout, cancellable
requests and a small serial final-only queue. Translation stays paired with its source.
Ignore late callbacks after stop/restart. Empty, malformed, oversized responses, queue overflow
or transport errors fail explicitly without logging provider text or secrets. Strip complete
leading ChatMock think-tag blocks; incomplete reasoning must not become visible captions.

## Verification

Unit tests cover ASR-only setup, existing integrated setup, HTTP contract, URL restrictions,
optional authentication, reasoning/empty/error responses, queue order and cancellation.
Android debug/release unit tests, lint and APK builds plus the repository check are required.
Credential-free emulator checks cover draft cancellation, validation, help, independent fields,
local HTTP opt-in and light/dark layout. Protocol fixtures do not establish a live ChatMock
account or physical-device capture result; those limits remain explicit in the PR.

## Sources

- https://github.com/yuxino/mimi/issues/90
- https://github.com/RayBytes/ChatMock (reviewed main 5bd6e774648a107c989d5df9e360ac7dc8869370)
- https://help.aliyun.com/zh/model-studio/qwen-real-time-speech-recognition
