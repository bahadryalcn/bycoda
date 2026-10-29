---
name: feature-inline-visuals
description: Conversation inline HTML/CSS/SVG visual snapshots, visuals.preview/render tools, sandbox, portable persistence, provider and mobile fallbacks.
---

# Inline visual replies

## Purpose and keywords

UI-41 / CAP-VIS-01..05. Self-contained interactive explanations inside the desktop
transcript. This adds a distinct typed payload; ordinary HTML attachments remain source.

## Surface inventory

Baseline main@2d4d8371e, dirty shared checkout, inspected 2026-10-29. Search roots:
host/, src/features/sessions/, src/integrations/harness/, src/features/files/.

- `host/conversation-visual-tools.ts`: `visuals.preview` captures; `visuals.render`
  publishes a snapshot in the result, not to any external service. Exactly one of
  inline HTML or a workspace HTML path; existing `readHostFile` confinement.
- `host/conversation-tools.ts`: discoverable authenticated MCP/CLI schemas and
  descriptions; `host/server.ts` resolves the caller's project/session working copy
  and rechecks the original principal before returning a snapshot. No new grants.
- `host/inline-visual-preview.ts`: existing optional Playwright runtime, separate
  ephemeral headless browser/context, offline and all requests/WebSockets denied,
  opaque self-contained sandbox, screenshot plus bounded visible text returned
  through existing Conversation MCP image normalization. No shared lease/profile.
  Missing runtime is a setup-required error; no automatic installation.
- `src/features/sessions/model/inlineVisual.ts`: versioned title/HTML/height,
  validation and provider-envelope parser. Serialized snapshot limit 4000 characters
  leaves room under existing 8000-character tool-output retention. Larger data images
  fail explicitly. Relative assets are unavailable; use data URLs within the limit.
- `src/integrations/harness/core/apply.ts`: completed nonfailed/nontruncated tool
  results acquire `Block.inlineVisual`. Existing local/Host event flow owns delivery.
- `src/features/sessions/data/sessionStore.ts`: persist/hydrate validates snapshot.
  Rust session JSON storage remains unchanged; no new command or filesystem reader.
- `src/features/sessions/model/transcriptActivity.ts`: visuals remain outside folded work.
- `src/features/sessions/ui/InlineVisual.tsx`, `AgentTranscript.tsx`: titled inline
  frame, source disclosure, bounded height, shared Modal expansion/focus/Escape.
- Existing `src/features/files/ui/HtmlPreview.tsx`: preview token lifecycle, loading,
  failure/reload, opaque sandbox without same-origin/top-navigation grants. A fixed
  `remote://` snapshot path prevents local asset reads. A stricter leading CSP blocks
  network subresources, nested frames, forms and native/app APIs. Scheme events
  update color-scheme; generated content retains its own authored appearance.
- Locale families reuse Source/Expand and preview controls; new failure text is routed
  through `useT`. No user preference or storage keys change.
- Tests: `host/conversation-visual-tools.test.ts`,
  `src/integrations/harness/core/inlineVisual.test.ts`, existing HtmlPreview tests.

## Owner decisions

2026-10-29, current owner's UI remainder prompt, exact quote:

> UI-41: mevcut CAP-VIS-01..05 kayıtlarını inceleyip sohbet içi inline görsel kabiliyetini mevcut sandbox/izin sınırlarıyla uygula.

## Behavior to preserve

Original tool result/source remains accessible on unsupported providers/clients.
Preview executes only in the isolated sandbox and does not publish. Publication adds conversation output
only; existing scoped Conversation Tools credentials and revocation apply. No
operator authority, filesystem mutation, credential changes or external publication.
Snapshots contain their own image data, never mutable disk paths. Source disclosure
remains usable when native preview is unavailable. Drafts/attachments are untouched.

## Checks and visual scenarios

Run focused host/reducer/persistence/HtmlPreview checks after all fixes. Native
acceptance must exercise interactive script, app-API denial, network subresource
denial, same-origin denial, blocked nested frames, reload/reopen, source fallback,
theme changes, expansion/focus/Escape and failure/retry at light/dark 1280/800.
Fixtures and pure tests do not establish native sandbox enforcement.

## Known blockers and coverage

Implementation: desktop, Host tool schema/dispatch, normalization and storage done
in source; verification tracked in the canonical register, never accepted by this card.
Connected-machine payload is portable and never reads remote assets locally; live
remote/provider round trips require separate acceptance. ACP/CLI providers that omit
tool results retain ordinary text fallback and cannot promise an inline frame.

Mobile renderer is explicitly unsupported in this desktop delivery. Its corresponding
contract is a nonprivileged WebView with JavaScript only in an opaque sandbox,
no native bridge/file access, network subresources or navigation, bounded height,
same snapshot validation, theme and source fallback. Do not use Tauri commands in
Expo or infer acceptance from desktop. Existing mobile tool/source presentation is
the fallback until that renderer has explicit mobile ownership and device evidence.

Live claim API unavailable to this agent; parent coordinated file ownership. No
edits to App.tsx, Rust, mobile or the architecture owner's session mutation machinery.

## Committed handoff references

Uncommitted changes over the baseline above, no installation/release. Evidence and
focused check results: `temp/local/2026-10-29-redesign-remainder/inline-handoff.md`.
Build inclusion and owner acceptance remain separate gates.

## Proposals

Larger visual snapshots need a dedicated conversation-owned asset transport rather
than raising provider tool-output caps. This is not a delivered capability.
