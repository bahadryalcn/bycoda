# Platform source map

Source paths are repository-relative. Inspect current manifests and imports when
changing a boundary; these are starting points, not a frozen file-count inventory.

Host feature implementations and their focused tests belong together under their
feature directory (for example `host/assistant/` and `host/conversation/`). Keep
runtime composition and actual process entry points at `host/`; place RPC adapters
in their existing domain directory under `host/domains/`. Moving modules also requires updating runtime asset
paths, reviewed test-selection inputs, source maps and invariant baseline keys.

| Concern                             | Owners / checks                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Root runtime composition            | `apps/desktop/`, `packages/`, `package.json`, `pnpm-workspace.yaml`, Cargo manifests; `.artifact` owns placement                        |
| Dependency and embedded-input graph | `scripts/checks/repository-graph.mjs`, its adjacent tests; consumer source and Rust embedding must agree                                |
| CI selection and aggregate success  | `scripts/checks/ci-changes.mjs`, adjacent tests, `.github/workflows/ci.yml`; inspect current matrix and result aggregator together      |
| Host test classification            | `scripts/checks/host-test-selection.mjs`, adjacent tests, `host/vitest.config.ts`; retain unknown/drifted cases                         |
| Browser distribution                | `tests/browser/suites.json`, its runner/config consumers; validate discovery completeness separately from execution                     |
| Common candidate artifacts          | `scripts/build/release-common.mjs`, adjacent tests, `.github/workflows/desktop-package.yml`                                             |
| Native process guardian             | `packages/provider-process-guardian/`, `scripts/build/provider-guardian.mjs`, adjacent tests; normal JS development remains independent |
| Physical store admission            | `packages/physical-store-admission/`, `packages/physical-store-admission-node/`; verify exact current package paths before extraction   |
| Local update orchestration          | `scripts/update-local.ps1`, `scripts/local-update/`, `docs/local-update.md`                                                             |
| Model behavior evaluation           | `evals/`, `docs/reference/quality.md`; offline grader/fixture success is not model/live acceptance                                      |

Refer to existing architecture, testing and runner documents from the entry for
full contracts. Do not add historical timing/test totals or operator machine state
here; record those with exact source and environment in the task handoff.
