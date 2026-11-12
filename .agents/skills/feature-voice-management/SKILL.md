---
name: feature-voice-management
description: "Use when changing voice commands that operate the app: tool discovery, targets and project or session actions. Not for audio capture; see feature-voice."
---

# Global voice management development

Use for application operations through voice, independent of a coding session's lifetime. Audio recognition/playback belongs to [voice](../feature-voice/SKILL.md). Source paths below are repository-relative.

## Start and workflow

1. Trace the app bridge, controller and catalog in [the source map](references/surfaces.md).
2. Identify the unlocked project, captured default target, requested operation and exact existing Conversation Tools/social/runtime-log validator.
3. Preserve request identity and existing native owner-confirmation flows. Check source/revision again after async document reads or target changes.
4. Verify no-target, locked-project, stale draft, duplicate request and uncertain result paths. Read back operation results instead of treating queued as complete.

## Preserve

- Capture the default session/project at acoustic onset and activate that snapshot only after transcript acceptance, for local and realtime speech. Explicit targets must be visible/unlocked; a missing captured target must not follow a later tab.
- Reuse existing tool validators and dispatchers. Voice grants no new settings, provider, skill enable/install or Inbox authority. Git push/merge and social sends need native approval. Never synthesize owner approval or owner social principals for model calls.
- `voiceFeatureLexicon` expands localized labels and conservative Turkish suffixes for catalog discovery only. Preserve family/category filtering, exact tool IDs and target validation. Do not rewrite unknown proper names or treat a lexical match as recognition confidence or permission.
- Management sources are separate from targeted coding sessions. Creating a source or normal user session defaults to unsent and submits no first coding turn.
- Room Host-session submit uses exact revision/idle/draft admission and real `assistant-room` authorship. Preserve original command receipts and canonical accepted-run ownership after voice closes. Desktop sync provenance alone is not a desktop execution lease; never substitute another owner on uncertainty.
- Global discovery and application metadata use a real Room thread without a project. Global discovery also lists project tools (Room and voice mark them `requiresProject`); calling one still needs an explicit visible target. `workspace.projects.create` makes a new folder through native file access and adds it to the rail; it never reuses an existing folder. `workspace.projects.actions.list` only reads saved project actions and manifest scripts (`projectActionCatalog`); starting one stays on `devServers.start` or terminal tools and their gates. Project work retains explicit target grants. The global Room reaches files only in owner-chosen Assistant folders (`files.roots`); `commands.run` needs per-run approval unless the owner setting allows; `folders.*` is never a tool. A local thread is not a remote Host principal; never substitute another source after a failed route.
- Crew thread writes retain exact native review, snapshot revision and operation receipts. The operation ID differs from a run or directive request ID. A new coordinator is a real canonical session; accepted launch bookkeeping cannot restore permission for more effects after the reviewed state changes.
- Deduplicate identical request IDs; reject changed payloads. Retain unknown outcomes without automatic effect retry. Accepted/queued/stopping is not done.
- Management writes use exact native review, durable receipts and current target revisions. Recheck Git status inside its mutation lock. Thread work requires explicit execution settings and a real assistant-thread principal; never borrow a coding session or bypass goal plan approval.
- Bound list results and tool outputs. Preserve cursors, truncation and sampled event coverage. `events.subscribe` is bounded long polling, not durable replay. Keep every Host RPC family classified in `host/voice/voice-capability-coverage.ts`; a documented owner-only boundary is not an implemented voice capability.
- Close, stop, archive/delete, pause future schedules and stop current automation runs remain distinct operations with their existing confirmation/recovery paths. Drafts/attachments are untrusted data. Read only already-attached IDs, never arbitrary model-supplied paths. Do not focus, clear, send or commit IME on read.
- Check source identity after asynchronous reads/parsing. Retain original machine and path routing; metadata alone never establishes attachment content or vision. Preserve explicit capability limits: actual supported OpenAI image frames versus unavailable local text-only/xAI image inspection. Documents expose bounded text, not OCR, embedded image or chart understanding.

## Conditional references and checks

- Navigation and tool-result provenance: [continuity contracts](references/continuity.md).
- Tool/source/attachment bounds: [source map](references/surfaces.md).
- Scope provenance: [historical owner decisions](references/decisions.md).
- User behavior: [voice guide](../../../docs/guides/voice.md).

Use adjacent `voiceToolCatalog`, `voiceToolClient`, draft/document/controller tests and app bridge lifecycle tests. Host routing uses `pnpm exec vitest run --config host/vitest.config.ts host/voice/voice-tools.test.ts`. Management tests cover denied/revoked approval, changed revisions, reused request IDs, uncertain outcomes, native review parsing and global thread execution. Changed UI follows current task capture requirements. Mock/source checks cannot establish live external writes, real vision, microphone or installed acceptance.
