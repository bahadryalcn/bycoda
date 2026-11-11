---
name: feature-sessions-sidebar
description: Change conversation lists, sidebar/recent rows, filtering, pinning, rename, draft/status presentation or remote navigation. Preserve selection, history and project/execution identity; recovery and archive operations have separate contracts.
---

# Sessions sidebar

Own conversation collections and rows across the shell, session models, Host/native list projections and remote navigation. Projects owns the rail; recovery owns journals; Archive owns restore, unarchive and delete semantics. Mobile list consumers remain independently owned.

## Source starts

- UI composition: `src/app/shell/`; session UI, hooks, models and data: `src/features/sessions/`.
- Remote identity/navigation: `src/features/connections/model/`; shared wire contracts: `src/shared/model/host-contracts/`.
- Settled/active list state: `host/domains/sessions/lifecycle-model.ts` (a writable list state, not a lock).
- Host projection: `host/desktop/`; native list/storage entry: `src-tauri/src/session_store.rs` and `src-tauri/src/session_store/`.

## Workflow

1. Trace the shell row into selectors, persistence and remote navigation using the source map.
2. Inventory full, sidebar, recent and compact rows, menus, keyboard actions, paging and search.
3. Separate presentation from execution and lifecycle owners; preserve existing controllers.
4. Exercise retained selection/filter, draft restoration, async failures and remote routing; check narrow, long-label and keyboard states for layout changes.

## Preserve

- Keep project, selected session and execution checkout identity distinct; navigate remote records through existing adoption owners.
- Archive, delete, stop, settle and recovery dismissal retain separate locks, confirmation and recovery owners. Reading a list grants no authority.
- Standard/detailed and compact rows retain their density, accessible state and stable interaction slots; use the [row contracts](references/contracts.md#row-presentation).
- Submitted turn provenance owns provider history; preserve optional summary metadata through Native, Host and remote projections.
- Persist pin/order/filter/search/paging and sibling updates. Filtered rows never stand for the entire collection in bulk actions or counts.
- Validated delegated advisors and subagents stay out of ordinary lists, search and restored tabs. Resolve child links to the verified parent panel; retain child execution, request ownership and finished history independently of current defaults.
- Interrupted status and activity survive partial reads and quit/recovery; owner Stop stays terminal without erasing transcript bytes.
- Working summarizes the open project while retaining global counts and other-project paging; compare canonical keys including remote machine identity.
- Retain title drafts, focus, drag targets and native menus. Rename and regeneration keep exact owner/receipt, concurrent-title checks and locks; regeneration never submits a turn.
- Unsent text/attachments use existing mounted and restored composer-draft subscriptions, active-editor exclusion and saved-draft/status precedence.
- Update/footer state belongs to the displayed version and confirmed package; repository and update notices coexist with distinct dismissal rules.
- Pending/error actions retain their initiating control and retry path; deletion keeps failures, skipped records and cleanup warnings visible.
- Global New requires explicit visible-project choice, current locks/defaults/checkout and cancellation without creation; global row navigation keeps the list open.

## Focused checks

Use focused tests in `src/features/sessions/model/`, `src/features/sessions/data/`, `src/app/shell/` and `src/features/connections/model/`. Layout/navigation fixtures: `tests/browser/sessions/session-row-layout.spec.ts`; footer: `tests/browser/app-shell/update-footer.spec.ts`. Run changed-file checks and selected path suites per the testing guide; UI evidence follows task tier. Fixture navigation does not prove live remote or installed updater behavior.

## References

- [Source owners](references/surfaces.md): list projections, storage and navigation seams.
- [Detailed contracts](references/contracts.md): row layout, titles, drafts, activity, footer and preview behavior.
- [Workbench](../feature-workbench-design/SKILL.md): shell composition.
- [Archive](../feature-archive/SKILL.md) and [recovery](../feature-session-recovery/SKILL.md): lifecycle operations.
- [Managed workspaces](../../../docs/reference/managed-workspaces.md): checkout identity.
- [Workbench guide](../../../docs/guides/workbench.md): user behavior.
- [Owner decisions](references/decisions.md): settle instead of close, footer coexistence.
- [Testing order](../../../docs/reference/testing.md): check selection and evidence.
