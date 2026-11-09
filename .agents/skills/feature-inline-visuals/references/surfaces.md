# Inline visual surfaces

Paths are repository-root relative.

- `src/shared/ui/Sheet.tsx`: shared non-modal, resizable side panel for the conversation-owned snapshot. `src/integrations/harness/core/toolWorkflowGuidance.ts` supplies proactive visual-answer guidance when the conversation bridge is offered.

- `host/conversation/conversation-visual-tools.ts`: `visuals.preview` and `visuals.render`, HTML/path exclusivity and existing confined file reads; `host/conversation/conversation-tools.ts` exposes authenticated MCP/CLI schemas; `host/server.ts` resolves caller project/session and rechecks principal.
- `host/conversation/inline-visual-store.ts`: content-addressed `inline-visuals/<sha256>.json` under the Host data folder; `src-tauri/src/inline_visual.rs` (`inline_visual_read`) reads it by id for the local Host only.
- `host/conversation/inline-visual-preview.ts`: optional existing Playwright runtime, isolated ephemeral context, network denial, screenshot, measured content height, console lines and bounded visible-text result. A missing runtime starts the pinned `BrowserRuntime.setup()` in the background and returns `installing: true` without waiting; other browser users get the same first-use setup from `BrowserRuntime.load`.
- `src/features/sessions/model/inlineVisual.ts`: versioned title/HTML/height validation, provider envelope parsing, theme token map and sandbox page assembly. Check actual constants before changing limits; the reference must stay small enough for retained tool output.
- `src/integrations/harness/core/apply.ts`: completed/nonfailed/nontruncated tool result normalization to `Block.inlineVisual`; `src/features/sessions/data/sessionStore.ts` validates persisted/hydrated snapshots.
- `src/features/sessions/model/transcriptActivity.ts`: visuals remain outside folded work. `src/features/sessions/hooks/useInlineVisualSource.ts` resolves references; `src/features/sessions/ui/InlineVisual.tsx` and `AgentTranscript.tsx`: inline frame, loading/retry, source disclosure and shared Modal expansion.
- `src/features/files/ui/HtmlPreview.tsx`: preview-token lifecycle, opaque sandbox, leading CSP, reload/failure and fixed remote snapshot origin without local asset reads. Rust JSON session storage remains under its existing owner; no new reader is implied.
- Tests: `host/conversation/conversation-visual-tools.test.ts`, `src/integrations/harness/core/inlineVisual.test.ts` and HtmlPreview tests. Search actual Source/Expand/failure labels in locale catalogs and preserve fallback on unsupported clients.
