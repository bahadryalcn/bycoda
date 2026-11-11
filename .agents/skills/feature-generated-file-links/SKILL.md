---
name: feature-generated-file-links
description: Fix conversation file-link recognition and output-folder resolution while preserving machine identity and document viewer dispatch.
---

# Conversation file links

## When and scope

Use for generated-file links, inline filenames and paths in assistant messages.
File contents and native filesystem authorization remain with their existing
viewers and platform readers. Read the Markdown preview skill when changing
document rendering or Preview/Source composition.

## Source starts

- `src/features/sessions/ui/AgentMarkdown.tsx`: inline-code and explicit-link
  recognition, message-context fallback and click/context-menu dispatch.
- `src/features/files/model/messagePathContext.ts`: bounded extraction of folders
  named in the same reply and metadata-confirmed file candidates.
- `src/shared/lib/paths.ts`: path recognition, normalization and machine identity.
- `src/features/files/model/fileIndex.ts`: indexed file-open resolution.
- `src/features/files/ui/DocumentView.tsx`: PDF, DOCX and table viewer dispatch.
- `docs/guides/explorer-and-file-content.md`: user-visible file opening behavior.

## Preserve

- Keep the session execution cwd distinct from the project display name.
- Keep absolute and connected-machine paths on their owning computer; never
  substitute local files for remote references.
- Existing direct paths win. Contextual alternatives require filesystem metadata;
  an unavailable metadata read does not confirm that a file exists.
- A folder may be written once before a list of bare filenames, including a
  relative folder whose first segment repeats the cwd's own folder name.
- Keep candidate counts bounded and preserve indexed resolution, ignored-output
  fallback, keyboard activation, context menus and exact navigation locations.
- Dispatch document files to existing readers, preserving errors, retry,
  default-app actions and read/size/permission gates.

## Workflow and checks

Trace recognition, context candidates, metadata checks and the final open callback
before changing a viewer. Reproduce ignored output folders and Windows paths with
spaces. Verify HTML/PDF/DOCX inline names and explicit links, direct-path priority,
missing files, native read failures and remote ownership.

Run focused Vitest checks for `messagePathContext.test.ts`,
`AgentMarkdownFileLinks.test.ts` and affected viewer/path tests. The standalone
`tests/browser/chat/generated-file-links.playwright.config.ts` fixture exercises real
Markdown rendering with mocked filesystem metadata. Fixture clicks prove dispatch,
not an installed native app's ability to read or render the owner's documents.
