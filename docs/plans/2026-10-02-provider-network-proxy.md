# Provider network proxy choices

Mimi exposes one application-wide `networkProxy` preference with `system`
(the default), `direct`, and `custom` modes. Older preferences default to
`system`. HTTP translation and WebSocket recognition/translation use the same
resolved, immutable routing snapshot for each client construction, including
explicit connection checks. Reconnecting creates a fresh client and can read
new operating-system proxy settings; a running client does not re-read them.

Changing the preference requires a stopped session, including when paused or
connecting. The existing lifecycle mutation guard serializes the preference
write with start/stop; a rejected mutation returns
`network_proxy_change_requires_stop`. A session's immutable configuration keeps
its captured preference. A failed validation or disk write leaves published
preferences unchanged.

`direct` explicitly disables automatic HTTP and WebSocket proxies. `system`
reads the standard environment settings and supported static system HTTP/HTTPS
settings through the shared system matcher. It does not execute PAC scripts;
macOS SOCKS-only system settings are outside that matcher's system integration.
`custom` supports credential-free `http://`, `socks5://`, and `socks5h://`
endpoints. HTTP proxies tunnel WebSockets with CONNECT. SOCKS5 performs local
DNS; SOCKS5h sends the destination hostname to the proxy. HTTPS proxy URLs,
proxy authentication, arbitrary paths, queries, fragments, port zero, and
oversized endpoints are rejected. Unused custom addresses are removed when
switching to system or direct.

Proxy endpoints are preferences, never additional provider credentials. No
process-global environment is mutated. Existing destination TLS verification
and provider authorization remain in place; HTTP redirects are disabled so
an endpoint-specific captured route cannot silently migrate to a different
destination. Unsupported/authenticated matched proxy routes fail closed.
Error labels and Debug representations omit proxy hosts, authentication, and
provider payloads. Support diagnostics must not include proxy addresses.

Focused regressions cover defaults and wire shape, validation, private Debug
output, global persistence across profile selection, rollback, identical
probe/session configuration, rejection during active sessions, HTTP proxy
routing, and local WebSocket CONNECT/SOCKS negotiation. Local synthetic
fixtures do not establish compatibility with every proxy application or PAC
configuration; signed native acceptance remains separate.
