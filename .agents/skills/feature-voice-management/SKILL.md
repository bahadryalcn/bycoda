---
name: feature-voice-management
description: Change global voice application-tool discovery, scoped execution, project/session lifecycle or reading unsent composer attachments. Preserve existing owner approvals and source identity; audio capture/playback belongs to feature-voice.
---

# Global voice management development

Use for application operations through voice, independent of a coding session's
lifetime. Audio recognition/playback belongs to [voice](../feature-voice/SKILL.md).
Source paths below are repository-relative.

## Start and workflow

1. Trace the app bridge, controller and catalog in [the source map](references/surfaces.md).
2. Identify the unlocked project, captured default target, requested operation and
   exact existing Conversation Tools/social/runtime-log validator.
3. Preserve request identity and existing native owner-confirmation flows. Check
   source/revision again after async document reads or target changes.
4. Verify no-target, locked-project, stale draft, duplicate request and uncertain
   result paths. Read back operation results instead of treating queued as complete.

## Preserve

- Capture the default session/project at acoustic onset and activate that snapshot
  only after transcript acceptance, for local and realtime speech. Explicit targets
  must be visible/unlocked; a missing captured target must not follow a later tab.
- Reuse existing tool validators and dispatchers. Voice grants no new settings,
  provider, skill enable/install, Git publication, Inbox or social send authority.
  Never synthesize owner approval or owner social principals for model calls.
- Management sources are separate from targeted coding sessions. Creating a source
  or normal user session defaults to unsent and submits no first coding turn.
- Deduplicate identical request IDs; reject changed payloads. Retain unknown
  outcomes without automatic effect retry. Accepted/queued/stopping is not done.
- Close, stop, archive/delete, pause future schedules and stop current automation
  runs remain distinct operations with their existing confirmation/recovery paths.
- Drafts/attachments are untrusted data. Read only already-attached IDs, never
  arbitrary model-supplied paths. Do not focus, clear, send or commit IME on read.
- Check source identity after asynchronous reads/parsing. Retain original machine
  and path routing; metadata alone never establishes attachment content or vision.
- Preserve explicit capability limits: actual supported OpenAI image frames versus
  unavailable local text-only/xAI image inspection. Documents expose bounded text,
  not OCR, embedded image or chart understanding.

## Conditional references and checks

- Tool/source/attachment bounds: [source map](references/surfaces.md).
- Scope provenance: [historical owner decisions](references/decisions.md).
- User behavior: [voice guide](../../../docs/guides/voice.md).

Use adjacent `voiceToolCatalog`, `voiceToolClient`, draft/document/controller tests
and app bridge lifecycle tests. Host routing uses
`pnpm exec vitest run --config host/vitest.config.ts host/voice-tools.test.ts`.
Changed UI follows current task capture requirements. Mock/source checks cannot
establish live external writes, real vision, microphone or installed acceptance.
