# Quality checks, evaluations and dependency patches

Quality checks should prevent observed failure classes while preserving normal development and existing owner approval gates. Source tests, offline synthetic evaluations, hosted CI, native/device acceptance and paid provider behavior are separate evidence layers. See [testing](testing.md), [platform foundation](platform-foundation.md) and [the eval standard](../../evals/README.md).

## Existing checks and gradual rollout

| Concern                                                    | Maintained check                                                                                            | Interpretation                                                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Portable Host/client import boundaries                     | `scripts/checks/check-host-runtime-boundaries.mjs` and its positive/negative fixture tests                  | Existing focused boundary authority; do not create a second import allowlist in the eval harness                                                       |
| Headless Host isolation                                    | `scripts/checks/check-host-headless-boundaries.mjs`                                                         | Preserves the existing Host/UI split                                                                                                                   |
| Source ownership and dependencies                          | `scripts/checks/repository-graph.mjs`                                                                       | Static production import/native-embed inventory, not a bundler graph or unused-code verdict                                                            |
| Reviewed lint debt                                         | `pnpm lint`, `pnpm lint:hooks`, optional `pnpm lint:baseline`                                               | Existing Oxlint/Oxfmt configuration and per-file/rule baseline; do not baseline errors or reset debt to conceal regressions                            |
| Code invariants (platform defect classes)                  | `pnpm check:invariants` (`scripts/checks/check-invariants.mjs`, ast-grep rules + `.oxlint-invariants.json`) | Ratchet over `scripts/checks/invariants-baseline.json`; rules and helpers in [code invariants](code-invariants.md); counts only fall                   |
| Code structure (feature folders, file size, layer imports) | `pnpm check:structure` (`scripts/checks/check-code-structure.mjs`)                                          | Ratchet over `scripts/checks/code-structure-baseline.json`; rules in [code structure](code-structure.md); counts only fall                             |
| UI component-usage conventions                             | `pnpm check:ui-drift` (`scripts/checks/check-ui-drift.mjs`)                                                 | Ratchet over `scripts/checks/ui-drift-baseline.json`; conventions in [ui-design-system](ui-design-system.md) and [code invariants](code-invariants.md) |
| Advisory unused/dependency and quality review              | `node scripts/checks/repository-usage.mjs --json`                                                           | Reuses the graph; flags possible review work without deleting, installing or adding an exit-code gate                                                  |
| Offline model contracts                                    | `pnpm exec vitest run --config evals/vitest.config.ts`                                                      | Synthetic corpus and deterministic grader tests; no model quality assertion                                                                            |
| Eval types                                                 | `pnpm exec tsc-rs --noEmit -p evals/tsconfig.json`                                                          | Normal tsc-rs mode, separate from application build                                                                                                    |
| Deterministic context bytes                                | `node evals/run.mjs --context-only`                                                                         | Report only; actual imported prompt/catalog serialization and sanitized DTO fixture boundaries                                                         |

Use existing shared Button/TextField/Popover/Modal/overlay adapters and permission contracts when changing consumers; the UI references in `AGENTS.md` remain authoritative. Do not add heuristic shared-control or authorization gates without reviewed failure examples. A schema, discovered tool or skill never grants execution authority.

The advisory quality scanner reports two narrow patterns: suppressions without an inline `-- reason`, and timer-backed Promise waits inside source tests. It parses comments and Promise calls rather than matching arbitrary strings as code. A nearby explanation may satisfy a suppression; a controlled-clock test may legitimately use a timer. These findings require review and do not establish errors or flakiness. Prefer observable events, queues or receipts for async completion; use an injected/controlled clock when time itself is the behavior. Never hide a failure with growing sleeps, retries or timeouts.

New structural rules need a reproducible failure, accepted and rejected fixtures, a reviewed current-repository baseline, a narrow owner and staged rollout. Keep report-only checks separate from hard correctness gates. Suppress only the narrow rule/line needed, state why the exception is safe and give the condition for removing it. A broad suppression or baseline count change is not acceptance evidence.

## Advisory usage analysis

The usage report lists production modules with no incoming edge in the existing static inventory, dependencies absent from its production imports, unresolved imports and unresolved/generated native embeds. App/tool entrypoints, workers referenced by URL, HTML/Vite/config/CLI/bin consumers, runtime registration, generated resources, optional/platform/peer dependencies and the separate mobile repo must be reviewed before action. Literal present Rust embeds are accounted for; computed embeds remain unresolved.

No export is declared unused. A proper export review must resolve reexports, aliases, public APIs, type-only consumers, dynamic access and native/platform consumption. Do not mass-delete modules, dependencies or exports from candidate lists. First identify an actual owner and all supported consumers, remove the usage deliberately, and run meaningful behavior checks for those consumers. The helper performs no manifest or lockfile mutation and has no hard gate based on candidate counts.

## Dependency patch governance

Do not import another project's patch collection, create an empty patches directory or change dependencies just to demonstrate patch support. This foundation change introduces no dependency patch or hook installation. Existing pinned package-manager and frozen lockfile behavior remain in force.

A required patch is maintained only with all of this information in its owning reference or a README next to the actual patch:

| Field                     | Required content                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package and exact version | Exact registry package/version and affected OS/architecture/runtime; no wildcard selector                                                                       |
| Reason and owner          | User-visible defect, affected callers, why a supported configuration/version cannot resolve it, and the maintainer responsible                                  |
| Minimal reproduction      | Steps or a deterministic regression fixture that fails without the patch and passes with it; preserve any native acceptance boundary                            |
| Upstream reference        | Actual upstream issue/PR and fix/release link when available; if none exists, explicitly say so and record the tracking owner rather than inventing a URL       |
| Patch and lock provenance | Patch file path/hash, the exact manifest registration and lockfile change; retain license notices and use the repository-pinned pnpm patch workflow             |
| Removal condition         | First verified upstream version or explicit condition, the same regression check without the patch, and removal of registration/file/obsolete metadata together |

Keep patch edits minimal and reviewable; patch authored source only where the package and build path require it. Do not silently patch bundled application code, credentials or a global installation. Recreate from the exact locked package during a version upgrade; a patch applying cleanly does not prove the underlying defect remains or the fix is correct. Check OS/architecture-specific behavior when relevant. A dependency upgrade must explicitly confirm whether the patch is retained, rebased or removed, with evidence.

Offline evals and diagnostics need no additional patch dependencies. Git hooks are opt-in and outside this work: never install a hook/service silently or turn every commit into a full test/release run.
