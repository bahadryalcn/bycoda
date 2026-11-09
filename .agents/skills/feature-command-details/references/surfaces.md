# Command inspection surface map

Paths are repository-root relative. Read for provider output, cross-view consistency or remote hydration work.

## Consumers and state

- `src/features/sessions/ui/ActivityDock.tsx`, `SubagentSheet.tsx`, `ToolInspectionPanel.tsx`, `AgentTranscript.tsx`, `SessionPane.tsx` (UI basenames share that directory).
- `src/features/sessions/model/commandInspection.ts`, `activityDock.ts`, `toolInspection.ts`, `stableBlocks.ts`, `backgroundStop.ts`, `session.ts` (model basenames share that directory).
- `src/features/sessions/hooks/useFollowBottom.ts`, `src/features/sessions/ui/useStopRequests.ts`, `src/platform/tauri/clipboard.ts` own follow, stop and copy effects.

## Provider and transport contracts

- `src/integrations/harness/core/types.ts`, `apply.ts`, `preview.ts`, `child.ts`, `toolDetailLimits.ts`: event shape, snapshot retention, truncation and task-output reads.
- `src/integrations/harness/providers/codex/codexProtocol.ts` and `codex.ts`: output deltas versus completed aggregates. `src/integrations/harness/providers/claude/claudeProtocol.ts` and `claude.ts`: foreground results and guarded background watcher. Inspect the actual adapter for all other providers; do not assume shared delta semantics.
- `host/child-backend.ts`, `src-tauri/src/harness.rs`: `harness_read_task_output` validates the task identity and canonical regular output file, returning a bounded tail/truncation result. Keep reads on the provider-owning machine.
- `host/engine.ts`, `host/server.ts`, `src/features/connections/model/protocol.ts`: existing session event/sync transport. Session sync does not imply a separate public live-command-log RPC.
- `mobile/src/features/workspace/transcript-tool-preview.tsx`, `transcript-block.tsx` in the same directory: phone output/truncation presentation; verify the nested repository independently.

## Focused checks

Search adjacent tests for the consumers/models above, plus core apply/preview and changed provider protocol/watchers. Browser entry points include `tests/browser/subagent-relay.spec.ts` and `tests/browser/session-usability.spec.ts`; add deliberate no-output, remote-load and follow-tail coverage when those behaviors change. Locale labels use actual sentence families such as Command details, Output, Copy, Stop and Output was truncated.
