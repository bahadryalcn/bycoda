---
name: feature-workbench-design
description: "Use when changing shell panes, rail and cross-feature navigation. Not for shared controls; see feature-shared-ui."
---

# Workbench design changes

Own shell composition and cross-feature navigation clarity. Each domain skill owns its workflows; shared UI owns reusable controls and theme owns semantic roles. This is a routing guide, not a product-wide audit or delivery tracker.

## Source starts

Full paths are repository-root relative; adjacent abbreviated names share the preceding directory. Follow current imports and callers; this map is not a completeness claim.

- `src/app/shell/`: title/menu/project rail/sidebar/window chrome.
- `src/app/workspace/layout/`, `surfaces/`, `actions/`: panes, mounting, navigation and action wiring.
- `src/shared/ui/`: public pane/header/row/action/feedback primitives.
- `src/features/sessions/ui/`: inspect actual transcript/composer/activity consumers when shell composition affects them.
- `src/features/sessions/ui/ActivityDock.tsx`: provider/model above title, metrics beside chevron, distinct lifecycle icons. Keep unknown child models unspecified and step failures separate from run failure.
- `src/features/sessions/ui/PromptOutline.tsx`: transcript prompt ruler and compact hover preview; suppress the shared Button tooltip because the preview already supplies the prompt. Keep the single-line title, two-line reply snippet, keyboard navigation and narrow-pane visibility policy.

## Preserve

- Translation presentation preserves immutable streaming lineage for unchanged history; translation toggles/source edits invalidate it. Selection actions keep stable callbacks that read current source without regrouping history for each text frame.
- Transcript parking budgets include retained tool details, previews, delegated output and inline data. Estimate without serializing large strings; active/approval ownership and durable conversation history stay independent from parked presentation eviction.
- Keep independent pane/editable-region boundaries readable at rest; use compact tools, spacious reading and less decorative containment without erasing ownership.
- Title/content/consequence lead metadata. Ordinary completed operations may summarize with detail available; active, failed, approval and recovery states stay discoverable.
- Preserve navigation identity, mounted drafts, selections, widths/density, shortcuts/context menus, drag/drop and native window behavior. Keep Settings outside the rail's scrolling content so its action stays visible in short windows, in both expanded and compact rails.
- Use one clear activity state signal; optional figures do not replace operational state. Failed reads are unknown, not empty/idle/success.
- Last Sessions is a collection view, separate from actual project and execution checkout. Keep it open on session selection; Explorer/Changes follow the selected session checkout. Project navigation exits the collection without losing drafts.
- Composition changes grant no Host, filesystem, Git, send or credential authority. Keep operation feedback with its initiating control or affected item.
- Native workspace actions use `emit_to` and the scoped helpers in `src/platform/tauri/listenWindow.ts`. Unknown window identity must not widen a subscription to all windows. Preserve explicit shared-state broadcasts, registration readiness for event replies, and cleanup during pending registration.
- Reload and unload act on the captured native page owner, never the global provider pool or remote Host turns. Keep reload confirmation for local running chats and dirty files, and retain the one-shot unload guard.
- Quit dialog pauses authenticate the quit run and physical page. Pause only the interactive confirmation itself; editor settlement, saving, terminal status reads and persistence retain the bounded watchdog. Abort before showing close failures. Keep stale replies from extending a newer quit.
- Claim conversation panes before opening or restoring them through `src/app/model/sessionWindowOwnership.ts` and the native `session_window_ownership` registry. Remote keys use environment and Host session identity, not generated local shell IDs. Focus the verified physical owner; unknown ownership never authorizes a duplicate tab or process replacement. Transfers retain source drafts until native destination acknowledgement, preserve the same transfer identity on uncertain replies, and keep running local turns queued until quiescent.

## Workflow

1. Identify the pane/task/action owner and route to the narrow feature skill before changing its domain behavior.
2. Compose existing shared primitives; change shared APIs only for a concrete reusable gap and coordinate their consumers.
3. Check shell navigation, representative retained editors and pending/error/recovery flows across rail and split modes.

## Focused checks

Run focused tests for changed shell/workspace owners, such as `pnpm exec vitest run src/app/shell/SidebarRename.test.ts src/app/shell/SidebarPagination.test.ts`; add affected feature tests rather than a product-wide blanket suite. Inspect compact/wide rails, split/unsplit panes, native menu/window controls, long multilingual titles, keyboard/context actions and retained draft return. Follow project tier visual checks; source maps and handoffs are not runtime acceptance.

## References

- [Design language](../../../docs/reference/DESIGN.md) for product hierarchy and [Workbench guide](../../../docs/guides/workbench.md) for user behavior.
- [Shared UI](../feature-shared-ui/SKILL.md) and [Theme](../feature-theme-foundation/SKILL.md) for reusable presentation.
- [Feature routing](references/features.md) only when the affected domain is unclear.
- [Owner design decisions](references/decisions.md) before reconsidering the shell direction.
