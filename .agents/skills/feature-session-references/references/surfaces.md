# Local session reference surfaces

Paths are repository-root relative. The canonical user/URI contract is `docs/guides/local-session-references.md`.

- `src/features/sessions/model/localSessionReference.ts`: versioned Host/Native paths, strict encoding, labels and optional cited turn. `src-tauri/src/session_store/references.rs` and registration in `session_store.rs`/`lib.rs`: read-only `session_reference_get` and `session_reference_resolve`.
- `host/server.ts`, `host/mcp/mcp-http.ts`, `host/desktop/desktopSessions.ts`, existing worker and `src/features/agent-app/model/`: additive verified references in existing list/read results. `src/app/workspace/control/useAppControlRequests.ts` retains current disclosure rules.
- `src/integrations/harness/core/conversationToolsBridge.ts`, `host/app-skills/bycoda/references/work.md`: exact returned first-mention link and read-before-describe guidance.
- Locate `AgentMarkdown`, `remarkLocalSessionLinks`, `LocalSessionReferenceContext`, `LocalSessionReferenceLink`: actual sanitizer/streaming path, lazy shared Popover, local pending/retry and invalid-internal-link handling.
- `src/app/workspace/sessions/useLocalSessionReferences.ts`, `src/app/App.tsx`, SessionPane and cited-turn history/navigation models: exact origin, visibility, bounded older history and stable user-turn routing. Search `localSessionNavigation` and `useCitedTurnHistory` for current definitions.
- Agent/worker panes use existing `AgentTabView`, `useReadOnlyHostSession`, `useOrchestrationWorkerPanes`, `useOpenSessionActions`; read-only preview must not mount queue/drain/send/recovery lifecycles.
- `src/app/shell/Sidebar.tsx`: local single-session plain/Markdown Copy actions with initiating action feedback. Notes/file Markdown consumers retain editing state and their anchor/button boundary; other shared Markdown callers must handle unavailable reference context.
- Tests: adjacent parser/navigation/Markdown/worker/Sidebar suites; `tests/browser/session-references.spec.ts` and its dedicated config. Include sanitizer streaming, repeated open, visibility revocation during loading, worker older-page citations and Notes selection/editing.
- Locales: exact link/details/open-beside/copy/retry labels in desktop catalogs. Current source identity and running native command availability must be checked independently.
