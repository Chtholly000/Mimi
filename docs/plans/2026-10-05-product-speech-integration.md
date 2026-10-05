# Speech product integration

Integrate recognition error recovery (#160), language configuration (#162),
realtime draft progression (#164), and native Apple Speech (#153) onto the
current product branch. Preserve main's independent recognition names (#161)
and live saved-service switching (#163). This is not a UI redesign or release.

## Boundaries

- Keep the existing system-audio default and explicit microphone choice, per-input
  recognition/subtitle lanes, bounded confirmed history, and recording consent.
- Retain source/target and saved-profile changes, pause/resume/stop cancellation,
  and stale-generation guards. A durable choice can survive reconnect failure;
  its initiating control must receive the failure and must not claim success.
- A failed resume restores the existing paused state under the same lifecycle
  lock used to validate ownership, then returns the error to its initiating
  control. A newer stop wins; failure cannot revive a stopped session. Settings,
  floating controls and tray show only allowlisted causes and ignore failures
  superseded by a newer resume or stop.
- Keep streaming drafts replaceable, confirmed pairs durable, HTTP previews
  paired, and the intermediate-subtitle toggle effective on all routes.
- Keep persistent safe error causes, one canvas recovery action when controls
  are closed, panel-owned detail when open, and independent settings/tray feedback.
  Error presentation may temporarily unlock/expand the window without persisting
  those dimensions or changing saved collapsed/locked/immersive preferences.
- Apple uses the native Speech APIs only on eligible devices. Explicit resource
  preparation and actual recognition-language selection remain separate actions.
  Native languages intersect the selected translator's implemented source codes.
  Runtime capability checks and the Xcode 26+ Apple Silicon build requirement
  remain part of the product; unsupported platforms retain unavailable adapters.

## Exclusions and evidence

External model runners, bridges, model presets, benchmarks, measurement scripts,
model-specific CI and experimental reports from #55 and #154–159 are excluded.
The pre-existing integration ledger stays unchanged; new mixed local-model run
reports are omitted. Apple queue regression source, build support and API/privacy
contracts remain because they support the actual shipped-code path.

The initial pass is source and diff review only. Earlier branch tests and native
measurements do not validate this combination. Focused regression authorization
is pending; no new model request, audio capture, build, installation, native UI
acceptance or release is implied by the integration.
