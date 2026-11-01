# Recovery surface map

Paths are repository-root relative. Search exact symbols through `src/app/`, `src/features/sessions/`, `src/features/files/`, `host/` and `src-tauri/src/` before changing actions or persistence.

- `src/app/workspace/layout/WorkspaceRecoveryDialog.tsx` composes conversation recovery and the independent file-copy catalog. `src/app/shell/SessionRecoveryControl.tsx` owns expanded/compact rail attention counts and existing entry visibility.
- `src/app/shell/SessionRecoveryPanel.tsx`, `src/app/workspace/sessions/useSessionRecoveryState.ts`, `useSessionRecoveryActions.ts`, `useOpenRecoveredSessions.ts` in that workspace directory retain aliases, selected/shown populations, previous chat layout, open/restore/clear/dismiss and journal acknowledgement.
- Saved journal and serialized native snapshot owners are distinct from live Host status verification. Follow current session storage, project locks, remote session IDs and existing tab registration instead of treating the dialog as a new session creator.
- `src/app/workspace/layout/EditorDraftRecoverySection.tsx`, `src/app/workspace/files/useEditorDraftRecovery.ts` and `useOpenRecoveredEditorDraft.ts` in that files directory own bounded copy list/search/filter, per-copy pending/retry and retained unknown preparation/open outcomes.
- `src/app/workspace/layout/LegacyBufferRecoverySection.tsx`, `HostBufferRecoverySection.tsx`, `BufferRecoveryReports.tsx`, `BufferReportRecoveryView.tsx` in that layout directory and corresponding recovery hooks keep local/Host report inspection distinct from qualified restoration.
- Native draft/source snapshots live with `src-tauri/src/session_store.rs` and source/editor recovery modules; Host-held reports have their own authority. Never treat a copied inspection report as a qualified source or durable save receipt.
- User contracts: `docs/guides/search-and-recovery.md`, `docs/guides/editor-draft-recovery.md`; source admission: `docs/reference/host-runtime.md`.
- Browser family: `tests/browser/session-recovery.spec.ts` and its existing fixture/config files. Search adjacent production tests for recovery actions, journal rollback, partial opens, locks, report inspection and editor draft hooks. Cover long identity strings, filter-hidden selection, failed reads, pending close and save failure.
- Localization: actual recovered/attention/status/restore/clear/selected-hidden/partial/save-failed sentence families in `src/shared/i18n/locales/` and overrides.
