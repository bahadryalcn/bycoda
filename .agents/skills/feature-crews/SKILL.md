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
- `host/crews/crews.ts`

## Workflow

1. Identify whether the change concerns definition editing, library/scope copies, work/run controls or ambient scene. Follow that surface to its current model and Host owner.
2. The editor is one autosaving page (access row, bulk model bar, member rows, Advanced). Preserve draft ownership when expanding members, filtering or adding; autosave sends only valid drafts with revision checks, one request at a time. Apply source-profile updates only through the explicit update operation.
3. Route mutations through the existing Crew client/service with revision checks and stable request IDs. Reconcile unknown outcomes with the authoritative owner instead of repeating Start.
4. Exercise model/catalog failure, conflicting edits, partial copies, run controls and current reviewer/request states; check adjacent task/settings/rail consumers when their contract changes.

## Preserve

- Scheduler reads use a transactionally backfilled SQLite active-run projection maintained by metadata insert/update/delete triggers, including legacy writers. Invalid source fails closed; history remains canonical. Delivery updates preserve original coordinator and persisted command identity. SQLite JSON write/trigger traversal still scales with canonical state; active payloads are never truncated.

- Owner-started work runs with the crew's `policy.runtimeMode` (default supervised, capability `crews.access.v1`); task-started work keeps the task's mode and members follow the run's mode.
- A member tool profile (`crews.tools.v1`) only narrows; the Host writes it into session model settings at start. `host/crews/crew-tools.ts` checks Host Conversation Tools before the existing authorization; `host/crews/crew-native-tools.ts` maps it onto provider-native tools (Claude, Codex; other providers refuse a read-only member), the MCP hub allowlist and the skill policy at the Host provider boundary.
- Retain every role/instruction, fixed/custom and automatic model choices, independent model settings, candidate ratings, scope/groups and defaults tombstones.
- Keep roster rows focused on name, role, model and groups; full instructions belong in the member form, not repeated instruction-heading previews.
- Saved-definition edits do not rewrite existing run/member/model snapshots. Device-local appearance must not change execution settings.
- Resolve an attached coordinator from Host storage or verified same-machine native metadata, retaining project, provider, model and runtime-mode identity. Never substitute a foreign session or create a partial Host session to satisfy a lookup. Prepare native metadata outside Host SQL ownership; keep transaction-time authority checks bounded.
- Coordinator event delivery and cancellation use existing command dispatch, run-lease, writer-retirement and durable-receipt gates. A running native coordinator is not idle; retain pending delivery and its command ID through ownership races or uncertain outcomes. Host-created child sessions retain their existing owner paths.
- Preserve capability-gated confirmed stop/delete, revision-bound deletion, dependencies/file leases, reviewer identity and retained failed/unknown request records.
- Crew acceptance is distinct from delivery/merge/publication approval. A read-like list that initializes defaults still needs its existing mutation admission.
- Keep read-view redaction, paired/conversation principal boundaries and local pending/error/retry. Role glyphs and status text must remain readable without motion or color alone.

## Verification and references

- Choose crew/crewClient/crewRoster/crewPresentation tests and changed UI tests; Host changes need relevant crews, lifecycle/defaults and dispatcher suites. Use `host/crews/crew-native-session.test.ts` for native coordinator resolution, ownership races and command routing.
- Use the affected UI matrix for Team/library/settings/work/rail states. Exercise isolated Host/native orchestration separately from browser fixtures; review scene motion and keyboard only when affected.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners, and [decision provenance](references/decisions.md) for owner decisions. Re-search current callers before broad changes.
- [Crew behavior](../../../docs/guides/crews.md)
- [Host service contracts](../../../docs/reference/host-runtime.md)
