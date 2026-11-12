---
name: feature-general-settings
description: "Use when changing language, power, tray and About settings. Not for log uploads; see feature-diagnostics."
---

# General settings development

Use for General Settings and its language, power, support/import/setup/guide, diagnostics and version/update entry points. Import/onboarding internals and app-update execution remain with their own owners and owner-directed workflow.

## Source starts

- `src/features/settings/ui/GeneralSettings.tsx`, `LanguageSettings.tsx`, `DiagnosticsSettings.tsx` and `BuildIdentityDetails.tsx` own presentation.
- `src/features/settings/model/keepAwake.ts`, `src/app/model/updater.ts` and `src/shared/lib/performanceTraceSettings.ts` own the main behavior boundaries.
- Read [surfaces](references/surfaces.md) for native registrations, lifecycle consumers and focused checks.

## Preserve

- Application, Git and technical-interface languages have separate defaults and scope. Preserve catalog generation/cache/retry and same-/sibling/system updates without changing user/code/OS content.
- Close-to-tray applicability differs by platform. Preserve close/flush/working-session protection and retained settings where unsupported.
- Keep-awake/display/hold choices are local-window intent; preserve dependent values, active-work classification, serialized native transitions, multi-window claims and cleanup.
- Diagnostics remain opt-in, bounded and privacy-safe. Preserve explicit Copy/Clear, allowlisted timing metadata, retained records on disable and target-local failure recovery.
- Import, Setup and Guide retain independent opening/dismissal/recovery and existing file-access gates. A support entry is not an implicit operation.
- Keep source/renderer/native/running/installed identity and Unknown comparisons distinct. Equal version or capture time does not prove included source.
- Updater feed/product gates, duplicate guards, progress, explicit install/restart authority and recovery remain intact. Do not turn a UI change into an install or publication.
- Preserve visible product attribution/contact, original defaults/storage keys and honest applied/durable/native outcomes.

## Workflow

1. Trace each edited control to its stored preference and actual OS/runtime consumer; avoid claiming effective power/menu/update state from a saved value.
2. Reuse shared Settings rows and existing update/support primitives. Consult [local update workflow](../../../docs/local-update.md) only for an owner-directed local build/install.
3. Select the focused suites in the map; exercise local feedback and preference failures, then relevant native menu/tray/power/updater boundaries in isolation when changed.

## Focused checks

Use the tests in the [surface map](references/surfaces.md) for the changed operation.

## References

- Read [surfaces](references/surfaces.md) for source maps and acceptance boundaries.
- Read [onboarding/guide](../feature-onboarding-guide/SKILL.md) for tour/import/help flows beyond their General-page entry.
