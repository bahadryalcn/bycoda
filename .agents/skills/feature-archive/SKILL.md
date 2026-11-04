---
name: feature-archive
description: "Change bycoda Archive collections, restoration, archived-session actions or sidebar archive mode. Preserve scope, deletion consequences, lock checks and truthful row outcomes."
---

# Archive development

All code paths below are repository-relative; linked skill resources are relative to this directory.

## When to use

Use for Settings Archive and related project/session archive entry points. Project removal lifecycle, session recovery and managed-workspace cleanup remain owned by their respective features.

## Start here

- `src/features/settings/ui/ArchiveSettings.tsx` owns the page; `src/features/settings/model/settings.ts` owns reveal metadata.
- `src/features/projects/model/recents.ts` and `projectData.ts` own project archive metadata; `src/features/sessions/model/sessionFilters.ts` owns sidebar mode.
- Follow [surfaces](references/surfaces.md) for session storage/actions, confirmation and platform routing.

## Preserve

- Keep app-wide archived projects distinct from selected-project archived conversations; unknown/unavailable/corrupt data is not an empty collection.
- Preserve searchable bounded collections, all-record reachability, retained selection and truthful loaded/count scope; rendering bounds must not silently cap stored records.
- Sidebar archived-only mode is a filter, separate from changing a record's archive flag. Patch the latest filter state without overwriting unrelated choices.
- Project Restore selects/opens it; opening an archived conversation does not implicitly unarchive or send. Open, unarchive and delete remain distinct.
- Project removal preserves the project folder while deleting the applicable app metadata/conversations; managed directory cleanup retains separate authority.
- Only confirmed successful removal/unarchive announces completion. Cancel, guard refusal, false return, failure and uncertain result retain truthful row state and retry.
- Successful conversation deletion retains a durable ID marker in its native/Host store. Late saves, adoption and restart recovery cannot recreate that ID; failed deletion transactions must not leave a marker. Unsent-draft editing uses its separate guarded disposal path.
- Revalidate captured targets on relock, project/machine/selection changes and concurrent removal. Preserve busy/dirty/queue/checkpoint/provider lifecycle gates.
- Preserve date meaning: project archivedAt differs from conversation last activity. Do not invent session archive timestamps, restored pin/order guarantees or remote/mobile parity.

## Workflow and checks

1. Trace collection reads and row callbacks through the actual project/session owner; verify result contracts before changing success feedback.
2. Exercise read/write/sibling recovery, large lists, cancel/false/failure and relocked targets with isolated data; use the focused suites in the map.
3. For UI changes apply the current tier's themes, widths and keyboard checks; report native/Host/mobile/installed evidence separately.

## Read when needed

- Read [surfaces](references/surfaces.md) for persistence, native/Host distinctions and focused checks.
- Read [Projects](../feature-projects/SKILL.md) for removal/restore lifecycle edits, [session sidebar](../feature-sessions-sidebar/SKILL.md) for filtering, or [managed workspaces](../feature-managed-workspaces/SKILL.md) for directory retirement.
