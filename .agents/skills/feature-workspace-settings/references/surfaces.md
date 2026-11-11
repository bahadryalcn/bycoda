# Workspace Settings surfaces

All code paths are repository-relative. Application workspace preferences and execution-workspace policy are separate.

| Area                  | Owner                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page/controls/reveal  | `src/features/settings/ui/WorkspaceSettings.tsx`, `WorkspaceSettings.css`, `WorkspaceFeatureSettings.tsx`, `WorkspaceFeatureGate.tsx`, `WorkspaceEditorSettings.tsx`; `src/features/settings/model/settings.ts` |
| Preference models     | `src/features/settings/model/workspaceFeatures.ts`, `exactGitRewind.ts`, `appearance.ts`; `src/shared/lib/storedSetting.ts` and current preference hooks                                                        |
| File/editor consumers | `src/features/files/ui/FileTree.tsx`, `FileEditor.tsx`, `CodeMirrorEditor.tsx`; file-tree/editor-timing models and app file-open owner                                                                          |
| Tool visibility       | `src/app/shell/Sidebar.tsx`, `ProjectRail.tsx`; `src/app/workspace/layout/WorkspaceToolPanels.tsx`; follow Notes/composer/agent-view/housekeeping consumers                                                     |
| Quick composer        | `src/features/quick-composer/model/quickComposer.ts`; native registration in `src-tauri/src/quick_composer.rs`                                                                                                  |
| Local Host experiment | `src/features/settings/model/exactGitRewind.ts`; `host/git/exact-git-rewind.ts` and managed runtime/dispatcher                                                                                                  |

## Data and authority

- Preserve reveal IDs for file-tabs, show-excluded-files, auto-save, format-on-save, working-agents, quick-composer, exact-git-rewind, Notes and tool visibility; verify exact current model names before changing controls.
- The Exact Git rewind preference uses `local_host_connect` and `workspaces.exactGitRewind.get/set`. Keep local-computer identity, actual acknowledgement/unknown/retry and owner/running-turn gates.
- Hiding Tasks/Automations/Inbox/Social retains active work/views. Notes affects additional context/save entry points; trace those consumers explicitly.
- Desktop Workspace settings do not imply phone parity. Mobile settings/routes use their own preference and native contracts; consult the mobile entry when extending them.

## Focused checks

Use WorkspaceSettings/WorkspaceEditorSettings tests, workspaceFeatures/exactGitRewind model tests and changed consumer tests. Save behavior requires `src/features/files/ui/FileEditorSave.test.ts` and `CodeMirrorEditor.format.test.ts` where relevant; source paths/actual current suites should be checked before invocation.

Browser: `tests/browser/settings/workspace-settings.e2e.ts`, `settings.e2e.ts`, `settings-subviews.e2e.ts` with their current Settings config. Exercise future-open tab placement, dirty-buffer Autosave, Format/undo/conflict, excluded files, hidden active tools, Notes context, busy/idle agents, sibling storage updates and failed writes. macOS registration and local-Host experiment outcomes need isolated native/Host checks; managed directory lifecycle has a separate owner.
