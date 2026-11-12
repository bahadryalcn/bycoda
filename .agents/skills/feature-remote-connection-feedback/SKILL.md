---
name: feature-remote-connection-feedback
description: "Use when changing remote outage notices and load feedback. Not for transport recovery; see feature-host-runtime."
---

# Remote connection feedback

Use for presentation of a remote machine's connection across mounted workspace
panes. Host runtime owns transport, identity and reconnect authority; domain
features own their mutations, retained data, drafts and uncertain outcomes.

## Source starts

- `src/features/connections/ui/RemoteConnectionFeedback.tsx`: workspace provider,
  per-environment registrations and shared notice ownership.
- `src/features/connections/ui/RemoteLoadError.tsx` and
  `src/features/connections/ui/RemoteConnectionBanner.tsx`: standalone fallback and coordinated feedback.
- `src/features/connections/ui/RemoteDataStatus.tsx`: per-data freshness and
  independent read errors.
- `src/features/connections/model/remoteHealth.ts`, `src/features/connections/model/remoteReconnect.ts` and
  `src/features/connections/model/remoteConnection.ts`: actual health and recovery; display grace grants no
  execution authority.
- `src/features/sessions/model/remoteActivityNotice.ts` and
  `host/desktop/remoteActivity.ts`: remote activity notices and the Host
  feed carried on the desktop heartbeat as `activity`.
- `src/app/App.tsx`, `src/app/shell/Sidebar.tsx`,
  `src/features/crews/ui/CrewSessions.tsx`: common owner and direct consumers.

## Workflow

1. Trace the exact machine/environment and affected read versus operation.
2. Reuse the common workspace provider. Register mounted environments and
   release registrations on unmount or route change; never retain the notice
   through its own registration.
3. Keep short transport outages quiet while existing recovery works. Escalate
   a sustained outage once per environment, retaining the first interruption
   time across repeated failed reads.
4. Keep standalone surfaces usable without a provider. Verify mounted/unmounted
   provider, retained and never-loaded data, independent service failures,
   identity/authentication refusal and explicit recovery.

## Preserve

- Raw connection status, send gates, reconnect settings, trust decisions and
  command identity are independent of notification timing. No mutation replay.
- Never suppress authentication, identity, schema, outdated-Host or uncertain
  operation recovery as a short network interruption.
- Suppress duplicate connection load notices only while a common owner exists.
  Keep independent service/data/operation failures and their Retry controls.
- A Host capacity refusal is a not-sent `RPC_WS_OVERLOAD`, classified
  `temporary`. Reads retry it quietly through `model/useQuietRetry.ts` and report
  it only after the last retry; it never resends a write.
- Every remote-device action that changes what another machine's screen shows
  records a remote activity notice. The Host resolves the requesting device
  name from the paired-device list; a device's own actions never notify itself.
- Remote activity notices are informational: they never gate sends, replay
  mutations or stand in for connection recovery.
- Retain loaded content and drafts. Never-loaded content is waiting/unknown,
  not verified empty. Missing log/build evidence is unknown, not healthy.
- The compact notice stays one row: title, Reconnect and `ErrorDetails`. Raw transport
  text and the secondary actions (edit address, connection settings) live in that popover.

## Focused checks

Use adjacent feedback/status tests, connection health/reconnect suites, and the
isolated `tests/browser/app-shell/remote-connection-feedback.html` fixture. Apply current
tier theme/width/keyboard checks; fixture evidence is not installed acceptance.

## References

Read [Host runtime](../feature-host-runtime/SKILL.md),
[workbench design](../feature-workbench-design/SKILL.md), and
[workbench guide](../../../docs/guides/workbench.md).
