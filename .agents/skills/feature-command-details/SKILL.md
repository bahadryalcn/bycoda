---
name: feature-command-details
description: Command details and background command output inventory for ActivityDock, retained exact command and cwd, provider delta versus snapshot flow, output completeness and remote hydration, Copy/Stop/navigation, follow-tail and honest silent/unavailable/interrupted states. Read before changing command inspection or command-output reporting.
---

# Command details and background output

## Purpose, scope and identity

Understand what a background command is doing and inspect available output without
inventing process liveness, losing retained bytes or bypassing execution gates.
Keywords: Command details, background command, Bash, exec_command, outputDelta,
stdout, stderr, tool.updated, aggregatedOutput, no output, tail, command inspection,
callId, remoteContent, Copy, Stop, Show in transcript, cwd.

T2 audit/design on2026-10-27, dirty shared
main@d8bf868fae841b8b391ce148487cd7d373ea9762, source0.6.94. One owner PNG has
UNKNOWN installed-source inclusion. Relevant history:9f9271f5a,29d534f9f,
cf3944cfb,07a34eff9,3419af022; sheet references8fc0b0a59,9ba9a6a9b,
3c68549eb,2732c2792; provider history includesd6cb4db10.
Live claim API unavailable in exposed tools; native agent/session and Git state
inspected. This card is not a concurrency lock. Preserve current provider/Host
migration, session/i18n and shared-control work; coordinate before implementation.

## Surface inventory

Search roots: src/features/sessions, src/integrations/harness/core and providers,
src/features/connections, host, src-tauri/src, tests/browser and mobile/src.
Re-enumerate copy/classes/events/RPCs and callers before edits.

- Desktop entry/state: `src/features/sessions/ui/ActivityDock.tsx`,
  `src/features/sessions/model/activityDock.ts`,
  `src/features/sessions/ui/SessionPane.tsx`, `SubagentSheet.tsx`,
  `SubagentSheet.module.css`; useSubagentSheet resolves current block by ID.
- Inspection: `src/features/sessions/ui/ToolInspectionPanel.tsx`,
  `AgentTranscript.tsx`, `src/features/sessions/model/toolInspection.ts`,
  `stableBlocks.ts`, `session.ts`. Retained command inspection is distinct from
  display title; tool detail versus agent-step output have distinct owners.
- Scroll/actions: `src/features/sessions/hooks/useFollowBottom.ts`,
  `src/features/sessions/ui/useStopRequests.ts`,
  `src/features/sessions/model/backgroundStop.ts`,
  `src/platform/tauri/clipboard.ts`, shared Button/Popover/overlay owners.
- Common provider model/apply: `src/integrations/harness/core/types.ts`,
  `apply.ts`, `preview.ts`, `child.ts`. Preserve bounded persistence and current
  snapshot semantics; do not globally append tool.updated.detail.
- Codex: `src/integrations/harness/providers/codex/codexProtocol.ts`,
  `codex.ts`: raw outputDelta513-525, completed aggregate802-825 and direct event
  forwarding1007-1040. Delta accumulation currently mismatches generic replacement.
- Claude: `src/integrations/harness/providers/claude/claudeProtocol.ts`,
  `claude.ts`: foreground results and guarded background output watcher1875-2009.
  Read failures are swallowed; failed final read can remove watcher. Preserve
  provider/path/task identity, mute/cancel and cleanup.
- Representative other adapters:
  `src/integrations/harness/providers/generic-acp/genericAcpAdapter.ts`,
  `src/integrations/harness/providers/opencode/opencodeProtocol.ts`,
  `src/integrations/harness/providers/fx/fxTool.ts`. Snapshot/merged output mapping
  is not every-provider live acceptance or separate stdout/stderr attribution.
- Host/native: `host/child-backend.ts` and `src-tauri/src/harness.rs` implement
  **harness_read_task_output** with safe task ID, absolute/canonical
  tasks/<id>.output regular-file checks and a32KiB tail/truncated result. Caller
  is provider-owning machine via core/child.ts; no arbitrary UI-path polling.
- Host common events/snapshots: `host/engine.ts`, `host/server.ts`,
  `src/features/connections/model/protocol.ts`. Existing sessions.sync,
  sessions.get and sessions.syncChunk are session transport, not proof of a
  dedicated public live-command-log RPC. Follow feature-host-runtime ownership
  and current compatibility/authority contracts before changing transport.
- Remote full-block UI: SessionPane/AgentTranscript already own explicit revision
  materialization. SubagentSheet has no loader wiring; show local load/retry or a
  truthful route, not a fake Refresh action.
- Native mobile counterpart: `mobile/src/features/workspace/transcript-tool-preview.tsx`
  and `transcript-block.tsx` display provider output/truncation. No dedicated
  desktop Command details/SubagentSheet caller found under mobile/src; phone
  output is not absent and device acceptance remains separate.

Locale families: Command details, Running, Done, Stopped, Failed, Command,
Working directory, Output, No output has been reported, Output was truncated,
Copy/Copy failed, Stop/Stopping/Could not stop, Show in transcript/Close. Preserve
provider command/output bytes and existing app/Git/technical language ownership.

## Owner decisions

2026-10-27, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, verbatim:

> command details da birşey gözükmüyor bunlarada bakabiliriz.

Audit request within the existing workbench direction. No command execution,
provider polling of arbitrary paths, process kill, auto-rerun, preference change
or new default authorized by this card. Prior compact-tools/open-content and
local operation feedback decisions remain in feature-workbench-design.

## Source findings and preservation

The screenshot's gh run watch redirects stdout/stderr; silence while waiting is
plausible, not proof of missing data. UI reads provider block fields only. Never
infer availability/suppression merely by parsing arbitrary shell commands.

Raw Codex deltas replace prior detail in generic apply; final aggregate can restore
a snapshot. Core detail8000-character cap lacks the tool.outputTruncated flag.
Retained exact inspection, output field precedence and explicit remote full-load
should be consistent across sheet/Copy/inspector. Claude read errors need truthful
waiting/unavailable/final recovery. Existing path/tail guards stay intact.

Preserve live block lookup and stable tool updates, exact retained command/result,
selectable/horizontal output, summary/full/legacy distinctions, per-command call
identity, historical data, partial/capped state and stop/mute/replay cleanup.
Dock pending/nonbusy=done and sheet pending/nonbusy=Stopped currently disagree.
No own command timing/exit/availability schema exists: turn startedAt/durationMs
must not become a fabricated command clock. Cwd is currently supplied workCwd,
not retained per-command provenance.

Copy needs pending/stale-result/timer/localized-scope recovery; preserve clipboard
fallback and focus/selection. Stop remains capability/call-ID gated with duplicate
guard and local failure/retry; acceptance is not verified process termination.
Show in transcript retains exact block identity and navigation recovery. Keep
nonmodal pane focus, Escape/IME/click-outside/return-focus and shared overlay stack.

## Proposals

Output-first sheet with compact meaningful header/actions, exact command available
on demand, subordinate known context, honest waiting/empty/unavailable/summary/
loading/error/truncated states and pinned-bottom following that pauses for the
reader. Reuse shared tokens/controls rather than a new terminal/overlay/log stack.
Typed availability/cwd/Host/exit/time/last-output additions require provider/core/
session/persistence/Host compatibility work; they are capability proposals, not
currently available metadata. Never rerun or kill a command to populate the UI.

## Checks, blockers and handoff

Register/brief: `temp/local/2026-10-27-command-details-audit/AUDIT.md` and
REDESIGN.md;12 records (two V+S/ten S),16-family checklist. Evidence:
`temp/verification/2026-10-27-command-details-audit/EVIDENCE.md`.

Existing focused tests: SubagentSheet, activityDock, stableBlocks, backgroundStop,
ToolInspectionPanel, AgentClock; core apply/preview, codexProtocol and claudeLive.
339 existing tests/10 suites pass in this audit.
Claude uses fake child/output reads; do not call that live-provider proof.
Headless child-backend/native harness tests are separate acceptance when those
guards change. Browser references include `tests/browser/subagent-relay.spec.ts`
and `session-usability.spec.ts`; command-specific no-output/remote/follow geometry
needs deliberate coverage rather than assuming the relay fixture covers it.

Implementation checks: multi-delta→final/repeated text, final read failure, silent
running versus finished-empty/unknown, capped/legacy/remote revision loading,
exact command/output precedence, interrupted lifecycle/provenance, Copy/Stop late
outcomes, selection/follow and all16 families at1280/800 light/dark plus narrow390,
keyboard/reader/locale/zoom/reduced motion. Isolated native/Host/provider/device
and installed identity are independent acceptance gates.

Concrete blocker: this is audit/design with no product patch or app/provider/
native/device run. Source/mock/schematic evidence is not a fix or live output
acceptance. Baseline above is the immutable reference; no committed repair SHA,
package/install/release delivered. Source inclusion UNKNOWN; ready to implement.

## Implementation 2026-10-28 (H6, uncommitted, untested)

Base `c03fa98d4`. Delivered for review: CMD-01..12. Nothing was run because of the
owner's no-test night rule. Handoff: `temp/local/2026-10-28-chat-impl/handoff.json`.

- Shared selector `src/features/sessions/model/commandInspection.ts` (exact command,
  output precedence tool.output > tool.detail > preview.output, dedupe, separate error)
  feeds CommandDetails, Copy and ToolInspectionPanel.
- `blockLifecycle()` in `model/activityDock.ts`: a pending block in an idle session is
  `interrupted` in the dock, the sheet and Copy.
- SubagentSheet: distinct running/finished-empty/stopped/interrupted/failed states,
  remote full-output load with pending/error/Retry and revision guard, follow-tail with
  Jump to latest, guarded Copy, "Session working directory" label.
- Codex outputDelta is accumulated per call ID in the provider. The core detail cap sets
  `tool.outputTruncated`, and the event has an optional `detailTruncated`
  (`core/toolDetailLimits.ts`). The Claude watcher reports waiting/unavailable
  output instead of swallowing read failures.
- Open: structured unavailable-output field (Claude notes are English text), and a
  flag for capped agent-step detail. Per-command cwd/timing/exit metadata remains a
  schema proposal.
