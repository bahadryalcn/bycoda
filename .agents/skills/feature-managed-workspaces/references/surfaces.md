# Managed workspace surface map

Paths are repository-root relative. The canonical architecture is `docs/reference/managed-workspaces.md`; this map selects implementation owners without duplicating that contract.

## UI and identity

- `src/features/workspace/ui/WorkspacePicker.tsx`, `src/features/sessions/ui/Composer.tsx`, `src/features/quick-composer/`: creation choice and quick launch.
- `src/features/source-control/ui/`: `WorktreesPage.tsx`, `WorktreePicker.tsx`, `SidebarWorktreeSwitcher.tsx`, `CreateWorktreeDialog.tsx`, `DeleteWorktreeDialog.tsx`, `QuickDeleteWorktreeDialog.tsx`; checkout Git surfaces remain with source-control.
- `src/features/workspaces/ui/WorkspacePolicySettings.tsx`, `WorkspaceRewindPreview.tsx`, `WorkspaceReview.tsx`; `src/features/settings/ui/BuildIdentityDetails.tsx`; `src/features/connections/ui/LocalHostUpdateNotice.tsx`.
- `src/app/workspace/projects/` create/select/remove hooks; `src/app/model/newWorkspaceSession.ts`; `src/app/workspace/sessions/submit/submitTurnRun.ts`; `src/app/workspace/derived/useActiveWorkspaceContext.ts`.
- `src/features/source-control/model/worktrees.ts`, `worktreeManagement.ts`, `worktreeRemovalControl.ts`, `worktreeFocus.ts`; `src/features/projects/model/linkedWorkspace.ts`; session compatibility fields in `src/features/sessions/model/session.ts`.

## Services, operations and persistence

- `host/workspace-contracts.ts`, `host/workspace-rpc-contracts.ts`, `host/workspace-service-contracts.ts`; type-only app mirror `src/features/workspaces/model/contracts.ts`.
- `host/managed-workspace-runtime.ts` composes registry/history/delivery/activity/removal/retention/bootstrap/ports and startup recovery. `host/managed-native-turns.ts`, `managed-native-activity.ts`, `managed-native-rewind.ts` retain device-bound coordination.
- Operation families: `workspaces.prepare/get/list/resume/finish/close`, `projects.workspacePolicy.get/update`, `workspaces.featureClaims.list/acquire/release`, `sessions.rewind.plan/apply/undo`, `workspaces.delivery.review/merge/publish`, `workspaces.cleanup.plan/apply/status`, `workspaces.storage.status`. Read exact current schemas and tokens before altering wire behavior.
- Rewind producers: `src/app/workspace/sessions/useCompactAndRewind.ts`, session model `conversationRewind.ts`/`conversationRewindStrategy.ts`, workspace model `rewindClient.ts`; provider reverts must not double-restore managed files.
- Task/goal/automation/steward integration: `host/task-workspace.ts`, `host/task-worktree-cleanup.ts`, their existing scheduler owners and `src/features/tasks/model/taskWorkspace.ts`. General Git mutations stay in their existing Host Git service.
- Native: `src-tauri/src/native_workspace.rs`, `session_rewind.rs`, `worktrees.rs`, `worktree_lifecycle.rs`, `checkpoint.rs`, `session_store.rs`; `src/app/workspace/files/useManagedWorkspaceBuffers.ts`, `src/features/workspaces/model/nativeManagedTurn.ts`.
- Development isolation/build identity: `scripts/build/dev-native.mjs`, `dev-shot.mjs`, `build-status.mjs`, existing local-update scripts and Host/dev-server owners. Never share another checkout's dependency links or mutable executable output.

## Checks

- Model suites: worktree removal/policy, conversation rewind/strategy and task workspace. Host: `host/git/git-worktrees.test.ts`, checkpoints/leases, cleanup and `host/managed-workspaces.e2e.test.ts` (fake providers).
- Browser families under `tests/browser/`: worktrees, workspace-actions, workspace-rewind, build-identity, git-workspace/checkouts, project-workspace-navigation and tasks. Select each family's existing config.
- Native checkpoint/lease/source tests need an isolated Cargo target/profile. Inspect nested `mobile/` separately; parent branch identity does not identify its source or build.
