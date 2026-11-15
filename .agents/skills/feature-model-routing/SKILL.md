---
name: feature-model-routing
description: Use when changing the Host-wide model order, limits, pools, role bindings and delegation defaults. Not for provider sign-in or catalogs; see feature-providers.
---

# Model routing

Own the Host-wide routing document and run-start resolution in `host/model-routing/`, shared wire contracts in `src/shared/model/host-contracts/`, routing controls in `src/features/model-routing/` and Settings Work composition. Tasks, crews, automations, assistant and voice own execution admission and run snapshots; providers own accounts and catalog availability. Native and mobile consumers retain their existing authority boundaries.

## Source starts

- Contract: `src/shared/model/host-contracts/model-routing.ts`.
- Host: `host/model-routing/service.ts`, `runtime.ts`, `selector.ts`, `storage.ts` in that folder.
- Domain port: `host/domains/model-routing/ports.ts`; domain code depends on this contract, not the implementation.
- Renderer polling starts in `src/features/model-routing/public/rendererBootstrap.ts`, imported by the main and Quick Composer entry points; keep startup side effects out of the Host-reachable defaults model.
- The renderer bootstrap also binds live catalog/account reads to `src/integrations/harness/core/automaticSubagents.ts`; the harness layer must not import feature stores. Preview reads remain live and `agents.options` remains authoritative.
- UI/public entries: `src/features/model-routing/public/`; query ownership in `src/features/model-routing/model/`.
- Smart setup: `model/smartSetup*.ts`, `model/modelProfile.ts` and the researched table `model/modelCatalogFacts.ts` under `src/features/model-routing/`; the order action edits the existing draft.
- Work settings composition: `src/features/settings/ui/work/WorkPage.tsx`; Providers > Defaults embeds chat defaults from `src/features/settings/ui/models/ModelsPage.tsx`.

## Workflow

1. Identify whether the change owns document editing, selection eligibility, delegation or a consuming feature's admission.
2. Trace the shared schema through the service and caller; consult the consuming feature skill before changing run persistence.
3. Preserve capability fallback, version-bound drafts and concrete execution identity. Update every consumer of a changed contract.
4. Exercise empty order, exhausted quotas, unknown limits, unavailable accounts, stale saves; check affected UI and user guides.

## Preserve

- Resolve only at run start; freeze the concrete model/account/settings on the run. Running sessions never switch model because the order, quota or pool changes.
- Empty order resolves to `notConfigured`; callers keep their stored model. Items without a routing choice remain fixed.
- All skipped entries resolve to `noEligibleEntry`; work waits until `nextResetAt` when known. Never turn exhausted eligibility into the stored-model fallback.
- Unbound `text.*` roles retain each helper's cheap automatic model selection. Explicit role bindings override that behavior.
- Pools contain ordered references to main-order entries and to other pools, never independent copies of models or limits; included pools flatten depth-first and deduped, and cycles are rejected. Running and historical snapshots keep their concrete models.
- Smart setup is owner-triggered and plans the order, pools and every role binding in one draft edit. It keeps entry ids, account identities, limits and settings, refills pools with the planned names and leaves other pools alone. The AI plan starts from the researched benefit-per-cost baseline in `model/modelCatalogFacts.ts`; any invalid or missing answer falls back to the deterministic rule plan. `ROLE_NEED` in `model/smartSetup.ts` classes every role as light, standard or heavy, and `enforceRoleNeeds` moves an AI binding whose pool does not suit that need. Entries are created per candidate and effort (`poolEffort`: light-only pools low, any heavy role high, else medium; the order medium) and never above high; an owner entry above high is reused for high pools. Save through the existing version-bound transaction, never during discovery.
- Scope filtering: a run with a project folder skips entries whose account kind is the other scope (`otherScope`); untagged accounts are shared and fixed choices are never filtered.
- Delegation layers apply global, then provider, then account, then item. Subagents, advisor, effort ceiling and image models live separately from order-entry model settings.
- Saves are owner-only and use `expectedVersion`; stale saves retain drafts and require reconciliation. Reading capability or showing a control grants no write authority.
- Hosts without `models.routing.v1` retain fixed model behavior; unavailable reads must not masquerade as an authoritative empty order.

## Focused checks

- `pnpm exec vp test run --config host/vitest.config.ts host/model-routing/` covers storage/service, selection, runtime.
- `pnpm exec vp test run src/features/model-routing/ src/features/settings/ui/models/` covers routing controls and settings composition.
- Select consuming feature admission/snapshot tests when changing run-start behavior. Use [testing order](../../../docs/reference/testing.md) for aggregate gates and visual coverage.

## References

- [Models guide](../../../docs/guides/models.md): user-facing settings, inheritance and waiting behavior.
- [Host contracts](../../../docs/reference/host-runtime.md): authorization and transport ownership.
- [Owner decision](references/decisions.md): provenance for centralized order and limits.
