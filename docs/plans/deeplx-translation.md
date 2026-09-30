# DeepLX-compatible text translation (issue #70)

Add a separate `deepLX` service profile. Alibaba Audio 3.0 still recognizes
system audio with its own Model Studio key; only recognized sentence text
(including replaceable previews) goes to the user-selected DeepLX endpoint.
This is not official DeepL API support and does not replace ASR or support an
OpenAI gateway. No credentials or user content are used for regression tests.

The write-only credentials payload contains `asrApiKey`, `endpoint`, and an
optional `token`. All fields use existing profile-scoped OS secure storage;
no plaintext fallback or secret snapshots are added. Replacing credentials
requires entering all fields again, as with other structured profiles.

The public [DLX /translate protocol](https://github.com/OwO-Network/DLX/blob/main/README.md#translate)
uses POST JSON `text`, `source_lang`, `target_lang`. The public
[service implementation](https://github.com/OwO-Network/DLX/blob/main/service/service.go)
returns numeric `code` and string `data`, and accepts optional Bearer auth.
Private server auth and other response formats are not assumed compatible.

Base URLs gain `/translate`; existing `/translate` paths and reverse-proxy
prefixes remain intact. HTTPS is required except for localhost/loopback HTTP.
URL userinfo, query credentials and fragments are rejected. Redirects are not
followed. The client enforces an eight-second total deadline, one MiB response
and 64 KiB translated text bounds, including bodies without Content-Length.
Only fixed errors and numeric status codes are exposed; arbitrary server
messages, URL, token and original text are never diagnostic content.

Reuse the Audio 3.0 pipeline's bounded queues, stale-generation guards,
preview cancellation and ordered final lane. DeepLX is non-streaming, exposes
Turbo only, supports auto/ZH/EN/JA/KO source and ZH/EN/JA target. No Qwen-MT
request is issued for this profile; translation memory is not sent to DeepLX.
Stopping or changing sessions drops outstanding HTTP requests through existing
worker cancellation. Transient network/408/429/5xx errors use bounded retries;
authentication and malformed responses fail with an actionable next step.

The credential-free connection diagnostic skips private endpoints, as Azure
does; it reports network/authentication as untested. Validation uses synthetic
loopback servers and native UI-only mode without provider connections or audio.

Invalid endpoint submissions are validated next to the Endpoint field before
credential storage I/O. The field receives focus and its error is scrolled
into view. Failed saves retain only the user's unsaved editor draft; successful
save/use clears it. Stored secrets are never read back. Save and storage errors
appear inside the credential form and receive focus, rather than below the
profile rename/delete controls.
