---
name: feature-inline-visuals
description: "Use when changing inline visual tools, snapshots and sandbox rendering. Not for Markdown preview; see feature-markdown-preview."
---

# Inline visuals

Own the typed inline snapshot and its isolated renderer. Ordinary HTML attachments remain source/file previews. Rendering adds conversation output; it grants no external publication, native bridge, filesystem mutation or operator authority.

## Source starts

- `host/conversation/conversation-visual-tools.ts` and `host/conversation/inline-visual-store.ts`
- `src/features/sessions/model/inlineVisual.ts`
- `src/features/sessions/ui/InlineVisual.tsx` and `src/features/sessions/hooks/useInlineVisualSource.ts`
- `src-tauri/src/inline_visual.rs`
- `src/features/files/ui/HtmlPreview.tsx` and `src-tauri/src/html_preview.rs`

## Workflow

1. Trace preview/render from authenticated tool schema through project/session confinement and payload validation to provider normalization, reduction and storage.
2. Keep visuals self-contained and versioned: render stores the page content-addressed in the Host data folder and returns a small version 2 reference; legacy version 1 snapshots stay readable. Use the existing preview runtime and HtmlPreview sandbox rather than sharing a browser profile or adding another iframe authority.
3. Preserve source disclosure and ordinary tool-result fallback when a provider/client cannot carry or render the typed snapshot.
4. Check invalid/oversize payloads, network/native access denial, persistence/reopen and expansion/focus/retry on the affected client.

## Preserve

- Keep the inline frame compact with one toolbar of accessible icon actions for source, reload, side-panel opening and expansion. Reuse the shared resizable Sheet for the side panel, keep the conversation usable, and retain the mounted preview during source disclosure.
- Keep proactive visual guidance in `src/integrations/harness/core/toolWorkflowGuidance.ts` and Host tool descriptions aligned: use visuals when they clarify an answer, with short subject-based titles and fitted content; simple replies stay text.

- Accept exactly one inline HTML source or confined workspace HTML path. Recheck the original principal before returning a capture.
- Preview uses an isolated offline context; network/WebSocket/subresource requests, same-origin privileges, nested frames, forms, native APIs and top navigation remain denied.
- Visual images contain their own bounded data, never mutable local/remote asset paths. The tool result carries only `{version: 2, id, title, height}`; never echo page HTML back through tool output. The desktop reads a stored page only by a 64-hex id and rejects a hash mismatch.
- The page gets theme CSS variables from `INLINE_VISUAL_THEME_TOKENS`; theme values are filtered so they cannot leave the base style element. The doctype stays first so pages keep standards mode.
- Keep the original result/source accessible, shared Modal/overlay focus/Escape and local loading/error/retry. Generated content retains its authored appearance.
- HTML preview creation and cleanup share a renderer-chosen UUID and exact native page issuer. Unmount or a lost creation reply closes that same token; close-before-create cannot resurrect it. Retire proven old pages and fence closed tokens, but never age out a live iframe or unknown creation merely to admit new work.
- HTML asset reads use bounded background admission and release the preview registry during filesystem I/O. Recheck the original live issuer and token before returning bytes; overload and read failure retain no-store and sandbox headers.
- Mobile needs its own nonprivileged WebView contract and source fallback; desktop support cannot silently enable a native bridge or establish device acceptance.

## Focused checks

- Use conversation-visual-tools, inlineVisual reducer/persistence and HtmlPreview tests for the changed seam.
- Exercise sandbox denial in the actual native renderer when enforcement changes, plus reopen/theme/expansion at project-required dimensions. Pure tests and fixtures do not establish native sandbox enforcement.

## References

- Lasting contract choices: [decisions](references/decisions.md).
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners.
- [Host authority](../../../docs/reference/host-runtime.md) when changing this boundary.
