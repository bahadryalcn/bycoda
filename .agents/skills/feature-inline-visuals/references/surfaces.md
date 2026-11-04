# Inline visual surfaces

Paths are repository-root relative.

- `src/shared/ui/Sheet.tsx`: shared non-modal, resizable side panel for the conversation-owned snapshot. `src/integrations/harness/core/toolWorkflowGuidance.ts` supplies proactive visual-answer guidance when the conversation bridge is offered.

- `host/conversation/conversation-visual-tools.ts`: `visuals.preview` and `visuals.render`, HTML/path exclusivity and existing confined file reads; `host/conversation/conversation-tools.ts` exposes authenticated MCP/CLI schemas; `host/server.ts` resolves caller project/session and rechecks principal.
- `host/inline-visual-preview.ts`: optional existing Playwright runtime, isolated ephemeral context, network denial, screenshot and bounded visible-text result. Missing runtime is a setup-required error, not automatic installation permission.
- `src/features/sessions/model/inlineVisual.ts`: versioned title/HTML/height validation and provider envelope parsing. Check actual constants: the snapshot must fit inside existing retained tool output; increasing a cap is not an asset transport design.
- `src/integrations/harness/core/apply.ts`: completed/nonfailed/nontruncated tool result normalization to `Block.inlineVisual`; `src/features/sessions/data/sessionStore.ts` validates persisted/hydrated snapshots.
- `src/features/sessions/model/transcriptActivity.ts`: visuals remain outside folded work. `src/features/sessions/ui/InlineVisual.tsx` and `AgentTranscript.tsx`: inline frame, source disclosure and shared Modal expansion.
- `src/features/files/ui/HtmlPreview.tsx`: preview-token lifecycle, opaque sandbox, leading CSP, reload/failure and fixed remote snapshot origin without local asset reads. Rust JSON session storage remains under its existing owner; no new reader is implied.
- Tests: `host/conversation/conversation-visual-tools.test.ts`, `src/integrations/harness/core/inlineVisual.test.ts` and HtmlPreview tests. Search actual Source/Expand/failure labels in locale catalogs and preserve fallback on unsupported clients.
