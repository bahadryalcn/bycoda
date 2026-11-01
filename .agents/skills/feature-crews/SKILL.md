---
name: feature-crews
description: "Change Crew definitions, member library, roles/models, rail and work views, approvals, run snapshots, task integration or ambient crew presentation."
---

# Crews

Keep saved teams, reusable member profiles and executing run snapshots distinct. Tasks own assignments/delivery lifecycle; Host runtime owns transport/operation authority; Appearance owns device-local ambient preferences. This skill is developer guidance, not permission to start a crew.

## Source entry points

Code paths below are repository-root relative.

- `src/features/crews/ui/CrewEditor.tsx`
- `src/features/crews/model/crewClient.ts`
- `host/crews.ts`

## Workflow

1. Identify whether the change concerns definition editing, library/scope copies, work/run controls or ambient scene. Follow that surface to its current model and Host owner.
2. Preserve draft ownership when switching members, filters, Team/Working settings or Back. Apply source-profile updates only through the explicit update operation.
3. Route mutations through the existing Crew client/service with revision checks and stable request IDs. Reconcile unknown outcomes with the authoritative owner instead of repeating Start.
4. Exercise model/catalog failure, conflicting edits, partial copies, run controls and current reviewer/request states; check adjacent task/settings/rail consumers when their contract changes.

## Preserve

- Retain every role/instruction, fixed/custom and automatic model choices, independent model settings, candidate ratings, scope/groups and defaults tombstones.
- Saved-definition edits do not rewrite existing run/member/model snapshots. Device-local appearance must not change execution settings.
- Preserve capability-gated confirmed stop/delete, revision-bound deletion, dependencies/file leases, reviewer identity and retained failed/unknown request records.
- Crew acceptance is distinct from delivery/merge/publication approval. A read-like list that initializes defaults still needs its existing mutation admission.
- Keep read-view redaction, paired/conversation principal boundaries and local pending/error/retry. Role glyphs and status text must remain readable without motion or color alone.

## Verification and references

- Choose crew/crewClient/crewRoster/crewPresentation tests and changed UI tests; Host changes need relevant crews, lifecycle/defaults and dispatcher suites.
- Use the affected UI matrix for Team/library/settings/work/rail states. Exercise isolated Host/native orchestration separately from browser fixtures; review scene motion and keyboard only when affected.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Crew behavior](../../../docs/guides/crews.md)
- [Host service contracts](../../../docs/reference/host-runtime.md)
