---
name: feature-platform-foundation
description: Change repository/package boundaries, build inputs, CI selection, test distribution, model evaluations or packaging. Preserve source provenance and development workflows; account/company product design is outside this scope.
---

# Platform foundation development

Use for cross-runtime module extraction, CI/build changes and package provenance.
Host execution authority belongs to `feature-host-runtime`; worktree policy belongs
to `feature-managed-workspaces`. Source paths below are repository-relative.

## Start and workflow

1. Read `.artifact`, package manifests and the affected consumer graph before
   moving a module. Follow JavaScript imports, native embeds and build inputs.
2. Use [platform architecture](../../../docs/reference/platform-foundation.md) and
   [the source map](references/surfaces.md) to identify current owners.
3. Change selectors, their actual consumers and aggregate result requirements
   together. Unknown inputs or drift must retain necessary coverage.
4. Verify affected graph/selection/provenance behavior with focused checks. A test
   discovery partition is not evidence that its tests ran on the target platform.

## Preserve

- Keep desktop, Host, portable packages and native modules behind their existing
  dependency boundaries. Mobile has independent repository/dependency ownership.
- Preserve local personal data and accountless use. Deferred company/account
  proposals do not authorize mandatory cloud identity or new operation permissions.
- Keep normal development builds usable; release/signing/install gates belong to
  their explicit workflows. A JavaScript Host build must not silently require a
  native guardian release bundle.
- Preserve immutable source/package hashes, embedded identity and bounded artifact
  paths. Metadata or equal versions do not prove installed source inclusion.
- Keep independent Host/app idle checks and recovery receipts. Failed observations
  are unknown; do not replay uncertain installs or terminate active work to proceed.
- Preserve existing process-test serialization inside a CI runner; parallelize
  isolated jobs rather than weakening their resource ownership.
- Keep guarded Windows runner admission and private caches. Workflow labels alone
  are not an authorization boundary; fixture checks do not establish live admission.

## Conditional references and checks

- Build/test edits: [testing](../../../docs/reference/testing.md),
  [CI](../../../.github/CI.md) and [quality](../../../docs/reference/quality.md).
- Local package/install work: [local updates](../../../docs/local-update.md).
- Windows Host packaging: `scripts/build/host-service-launcher.mjs` prepares the
  native launcher; portable cross-packaging needs matching prepared target bundles.
  Ordinary JavaScript Host builds must not require this native toolchain.
- Windows runner infrastructure: [runner contracts](../../../docs/reference/windows-runners.md).
- Scope decisions: [historical provenance](references/decisions.md).

Use normal `pnpm check:web` / `pnpm host:build` only when their inputs are affected;
use the focused graph/build helper tests identified in the map. Keep local,
cross-platform, signed-package and installed acceptance separate in the handoff.
