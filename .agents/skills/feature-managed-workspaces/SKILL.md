---
name: feature-managed-workspaces
description: "Use when changing checkout and worktree policy, execution identity, claims, rewind and delivery. Not for Git review UI; see feature-source-control."
---

# Managed workspaces

Own execution workspace contracts, not general Git UI. Read the canonical workspace reference for service interfaces and Windows removal rules. Session/task UI composes this contract; Host owns registry, activity, rewind and delivery admission.

## Source starts

- `host/managed/managed-workspace-runtime.ts`
- `host/workspaces/workspace-contracts.ts`
- `src/features/workspaces/model/contracts.ts`

## Workflow

1. Inspect the assigned checkout/branch and current feature claims; keep canonical project identity separate from execution cwd. Use the host-assigned workspace rather than creating another.
2. Resolve explicit creation choice, then stored project policy, then Host default. Trace normal/quick/session/task/automation producers through the shared resolver before changing policy.
3. Use existing service graph, journals and activity reservations for create/resume/rewind/delivery/removal. Bind previews and approvals to reviewed revisions and immutable identities.
4. Check current-mode and explicit-worktree success/failure, old Host capability, interrupted operation recovery, dirty overlap and sibling preservation with fake repositories.
5. Update the canonical reference and user guide only when their behavior changes; compare source/build identity before claiming a running binary includes the change.

## Preserve

- Current checkout is the default; explicit/stored worktree choices remain valid. Existing sessions retain execution identity. A worktree failure never silently falls back to current/main.
- Current-checkout work preserves concurrent dirty/staged state; managed writers retain their assigned owner/path. Directory retirement is distinct from branch deletion.
- Active, dirty, unknown or in-use state blocks automatic cleanup. Preserve rescue refs, journals, retry identity, exact rewind/Undo and unrelated new work.
- Retention preflight can reject dirty or private inputs early, but reviewed removal still binds the complete worker-computed fingerprint and revalidates it. A build-cache generation with unknown physical completion stays held even if its sentinel disappears; do not infer child-process exit from Host exit.
- A compatible Windows guardian may prove retirement with an exact-generation receipt checked under the SQLite witness. Remove only settled exact receipts; absent capability or unknown tree completion retains the existing held-state contract. Development builds must not require installing a guardian.
- Removal fixes a canonical boundary and checks descendants without following links. Never remove a junction target or another workspace to satisfy a check.
- Owner-reviewed delivery binds exact source/target identities and preserves unrelated target edits. Task completion or a tool response does not authorize merge/push/publication.
- General managed capability does not establish native turn/buffer/rewind capability. Missing source/build/idle reads are unknown, not safe.

## Focused checks

- Select workspace policy/removal/rewind model suites and relevant Host workspace, activity, checkpoint and cleanup tests. Isolated native changes need actual SQLite/receipt/interop checks.
- For changed UI use its state matrix; for removal/delivery use temp Git repositories and link-boundary cases. Fixtures do not prove live-provider or installed acceptance.

## References

- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners.
- [Canonical workspace architecture](../../../docs/reference/managed-workspaces.md) for policy, identity and retention rules.
- [Workspace user guide](../../../docs/guides/managed-workspaces.md) for user-visible behavior.
- [Local updates](../../../docs/local-update.md) for build identity and owner-directed installs.
