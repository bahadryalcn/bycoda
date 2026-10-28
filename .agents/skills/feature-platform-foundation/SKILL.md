---
name: feature-platform-foundation
description: Platform foundation, repository/package boundaries, CI sharding, install-input caching, release candidates, model evals, lint and packaging. Account/company research is deferred. Read before moving app roots or changing build boundaries.
---

# Platform foundation

## Purpose and keywords

Improve the existing repository through explicit code, execution and release
boundaries. Current scope excludes account/company work. Keywords: monorepo, apps, packages,
contracts, client runtime, infra, control plane, company, organization, tenant,
membership, login, evals, Oxc, Oxlint, patches, packaging, CI shards, build cache.
Use [the architecture reference](../../../docs/reference/platform-foundation.md).

This is a T2 cross-cutting inventory, not a reservation or a completed cloud product.
The active work is repository structure, module boundaries, build/CI, tests, lint,
packaging and evaluations. Account/company inventory rows below are retained
background, not current tasks or acceptance blockers.
Research baseline: `main` at `0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`,
2026-10-27; preserve concurrent dirty work. The current session is an existing
current-checkout session; no branch change or commit was made.

## First execution surfaces (2026-10-27)

The owner lifted the implementation hold on 2026-10-27 with:
"tamam subagentlarlar ile todoları yapmaya başla yap 4 subagent ile çalışabilrisin".
Four native subagents delivered independent CI, testing, updater and quality
scopes, integrated in the existing shared `main` checkout at
`d8bf868fae841b8b391ce148487cd7d373ea9762`. Account/company scope remains deferred.
No project staging, commit, branch change, installation or publication was
performed. The continuation requested on 2026-10-28 with "kalanlarıda yap"
includes frozen Windows BuildOnly packages and isolated native/old-DB smoke.
The production browser entry now renders the existing native-unavailable recovery
surface honestly; the native smoke protocol is opt-in and private-profile only.

| Surface                                | Implementation and evidence boundary                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared CI and local checks             | `.github/actions/setup-deps/`, `ci-changes.mjs`, `check-local.mjs`, `ci-results.mjs`, CI workflow: pinned setup, tested affected-input selection, bounded local commands and exact-source aggregate `Check`. Required job variants/reports cannot silently skip. Hosted execution remains pending.          |
| Test ownership                         | `tests/browser/suites.json`, shared fixture runner/server and inventory: 85 files, 46 default owners, three explicit variants. Actual discovery retains all 1498 unique browser identities with no missing/default duplicate. Chromium smoke 28/28; full browser/WebKit/native acceptance remains separate. |
| Host compilation and package selection | `scripts/build/host-inputs.mjs`, local updater/lib/install: actual build graph, verified compile outputs, separate provenance packaging and Host-only immutable manifests/archives. 67 updater fixtures pass; real package build/install remains unrun.                                                     |
| Recovery                               | Independent fresh idle observations, explicit same-package interrupted recovery and old-manifest selection. Unknown effects stay blocked. Only source/fixtures and read-only status were exercised; no helper resumed.                                                                                      |
| Source boundaries                      | `repository-graph.mjs` inventories consumers and Rust embeds. Existing Host runtime boundary/schema checkers remain the enforcement authority. Active Host/WS extraction is not duplicated or moved into new package roots.                                                                                 |
| Release source                         | `release-candidate.mjs`, `release.yml`, `desktop-package.yml`: exact successful full CI before draft creation, shared trusted tag packaging; five source-candidate regressions and local workflow validation. Nightly/preview policy and packaged old-DB smoke remain open.                                 |
| Quality                                | `evals/`, context metrics/usage/pattern reports: 12 sanitized cases, actual production prompt/tool/policy imports, synthetic baseline/control, 30 offline grader tests and normal tsc-rs. Reports are advisory; no model call, new global lint gate or dependency removal.                                  |
| Support                                | Diagnostic guide/playbook/form, PR template, security clarification and label-catalog synchronization; blank/incomplete/non-English reports remain welcome. No public reports or labels were sent.                                                                                                          |

Current commands and limits: [testing](../../../docs/reference/testing.md),
[quality](../../../docs/reference/quality.md), [CI](../../../.github/CI.md) and
[local updates](../../../docs/local-update.md). Full execution/evidence records:
`temp/local/2026-10-27-platform-foundation/TODO.md` and
`temp/verification/2026-10-27-platform-execution/` (first slice) and
`temp/verification/2026-10-27-platform-remaining/integration.md` (continuation).
Fresh six-shard discovery covers 261 Host files exactly once; this does not run
their modules. Maintained source is uncommitted and installed-build inclusion
remains unknown. GitHub read-only inspection found `main` unprotected and no
rulesets; requiring `Check` still needs repository configuration after delivery.

## Initial slice inventory and completeness (research baseline)

Search roots: `.github/`, `scripts/`, `host/`, `src/`, `src-tauri/`, `docs/`,
`.agents/skills/`; read-only nested `mobile/` and the existing Team/Host plans.
Upstream: official `pingdotgg/t3code` at
`36d4d711b79c73eb33131944f73ea4a8c6156484`, including the named directories,
workspace manifests, release workflow and relay identity/storage.

| Surface                        | Paths                                                                                                                      | Status and evidence                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host CI partition              | `.github/workflows/ci.yml`, `host/vitest.config.ts`                                                                        | Local implementation: 6 Windows/2 macOS/1 Linux shards; serial files retained; package once/OS and unique report artifacts. Hosted execution pending delivery.      |
| Shard completeness             | `scripts/checks/check-host-test-shards.mjs`                                                                                | Actual installed Vitest sequencer selects every one of 236 files once for 1/2/6 partitions without running modules.                                                 |
| Dependency reuse               | `scripts/local-update/local_update.py`, `test_local_update.py`, `docs/local-update.md`                                     | Local implementation: version-only reuse, pnpm lock/config/patch invalidation and one-time legacy marker refresh. 61 fixture tests pass; no live build/install.     |
| Developer guidance             | `CONTRIBUTING.md`, `docs/reference/platform-foundation.md`                                                                 | Delivered local documentation: commands, directory comparison, current/proposed distinction, staged migration and acceptance.                                       |
| Personal/account/company model | `host/team-access.ts`, `host/provider-accounts.ts`, `src-tauri/src/account_identity.rs`, `host/store.ts`, `host/server.ts` | Inventoried only: personal device/provider identity exists; company policy is not wired to RPC or an identity verifier. Company login/services are not implemented. |
| Delegated tool grants          | `host/mcp-tokens.ts`, `host/runtime-log-tools.ts`                                                                          | Existing scoped expiring grants; no company membership authority inferred.                                                                                          |
| Native/mobile secrets          | `src-tauri/src/remote.rs`, separate `mobile/src/state/machines.ts`                                                         | Read-only inventory; desktop restricted JSON and mobile SecureStore differ. New account/native acceptance remains future work.                                      |
| Host/transport migration       | Existing `temp/local/2026-10-27-host-architecture-plan/PLAN.md` and W00-W11 documents                                      | Existing proposal retained as migration authority; no runtime/transport switch in this slice.                                                                       |
| Organization control plane     | Existing `temp/local/2026-10-18-team-platform/` and new reference                                                          | Detailed proposal only: identity/membership, grants/enrollment, audit/outbox, isolation, collaboration and billing boundaries.                                      |
| Tooling and distribution       | Root Oxlint/Oxfmt/tsc-rs configs, `scripts/checks/`, `scripts/build/`, `scripts/release/`, `vendor/`                       | Existing equivalents inventoried. No paid eval, external review service, remote cache, AUR publication or dependency patch imported.                                |

No product UI, RPC identifier, Rust command, mobile route or locale text changed.
There are no new account/team UI screenshots because those interfaces are not
implemented by this slice. AI Crews and project-layout organization RPCs are not
human company membership infrastructure.

## Owner decisions

- 2026-10-27, owner request in
  [T3 Code Sürüm Yönetimi Farkları](t3-thread://v1/c1074ad0-bdda-4f68-b17d-3c3432d00abb):
  "Bizde benzer bir yapıya geçiş yapalım."
- Same request: "kullanıcıların login olduğu takımların şirketlerin olduğu bir yapı".
  This is the original broader direction; its account/company portion is deferred
  by the later clarification below. It is not implementation evidence.
- Later clarification in the same conversation/date:
  "şuanda onu düşünme sadece yapıya bak kurumsal işi sonraya".
  Focus on structure now; defer accounts, company services and deployment choices.

Prior personal accountless policy is rechecked against the existing Team plan and
published privacy guide. The owner deferred the asynchronous cloud/self-host
question; no answer is needed for this scope. Agent architecture proposals below
are not quoted owner decisions.

## Behavior to preserve

- Local personal data, projects, drafts, sessions, Git, terminal and provider
  profiles remain available without a mandatory cloud account/subscription.
- Keep Host/app independent idle checks and frozen build provenance. Do not skip
  live session gates to make installation faster. Do not claim a new source is
  included in reused old binaries.
- Preserve immutable package hashes, recovery receipts and no automatic replay
  after uncertain mutations. No new permission follows from a company login,
  project listing, network tunnel, subscription or AI Crew membership.
- Keep existing serial process integration inside each CI VM; isolate via separate
  runners. Never claim discovery-only partition checks execute all tests.
- Keep mobile's independent repository/dependency ownership. New root paths need
  `.artifact`, build/filter/cache/lockfile and import-contract updates together.

## First-slice checks and evidence

```sh
python -m unittest discover -s scripts/local-update -p test_local_update.py -v
node scripts/checks/check-host-test-shards.mjs 6
node scripts/checks/check-repository-hygiene.mjs
```

CI also checks its matching 1/2/6 partition count. A six-file/two-shard Windows
sample passed 53 tests with disjoint reports. Evidence:
`temp/verification/2026-10-27-platform-foundation/` and
`temp/verification/2026-10-27-ci-shards/`. Run focused Oxlint/Oxfmt and diff checks
on touched supported files; no full build is required for these Python/CI/docs
changes. Product UI capture matrix is not applicable to this slice.

## Known blockers and coordination

- Hosted CI duration/platform execution: no workflow delivery/run was performed.
- Installed application inclusion is unknown; frozen BuildOnly and isolated smoke
  evidence are recorded separately in the continuation report.

Company pilot, native login, tenant isolation and deployment-specific infrastructure
are explicitly deferred; their missing services/configuration are not blockers for
the current structural work.

Claim RPC tools were unavailable to this runtime. Read-only SQLite inspection of
the local Host's `workspace_feature_claims` table returned no rows on 2026-10-27;
other thread/worktree state and dirty paths were inspected. No claim was acquired.
This card is not a concurrency lock. Keep one writer per file and recheck before
future slices.

## Committed handoff references

Baseline only: `main`, `0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`.
The delivery is an uncommitted local source change in an existing current checkout.
No own commit, branch switch, push, merge, PR, installed build or release exists.
Installed-build inclusion is unknown. Frozen local package identities are recorded
in the continuation report; they do not prove inclusion in a public release.

## Continuation surfaces and remaining acceptance

- Workspace: `apps/desktop` has real HTML entry modules; `packages/core` owns
  portable helpers used by desktop, Host and mobile. Compatibility exports retain
  old paths. Normal tsc-rs, public/transitive boundary fixtures and Host input
  graph checks protect the extraction. Full Host/UI root relocation is not claimed.
- Browser CI: ten full partitions cover 1498 default plus 106 explicit variant
  cases, with required receipts/report hashes and an aggregate Check. PR smoke
  remains 28 cases. Built-web boot checks embedded frozen identity and real Reload.
- Release: reusable desktop packaging, exact-source stable/nightly/preview
  candidates, real signatures/hashes, bounded archive validation, six Host targets,
  explicit local-frozen exclusion from publication and retained smoke diagnostics.
- Optional operations: advisory PR scope, index-only staged checks, hook plan and
  explicit installer, bounded APT fallback, trusted-main-only deterministic output
  cache. No owner hook, remote cache or GitHub settings were enabled.
- Mobile: independent dependency/bootstrap contract, native fingerprint, guarded
  EAS preview, source-stamped staging and virtual-device artifact/foreground proof.
  Windows diagnostics retain exact source/file/OS receipts. No paid EAS or device
  acceptance is inferred from source tests.
- Host packaging: CommonJS dependencies bundled into ESM receive Node createRequire;
  a real bundled WebSocket round trip protects startup. Frozen BuildOnly selects
  an already cached exact pnpm binary without modifying global installations.

The continuation evidence report is authoritative for current counts, build stamps,
native smoke status and concrete external blockers. Hosted CI at a delivered commit,
Mac native execution (SSH unavailable), signed publication and EAS/device execution
remain external acceptance. Keep corporate work deferred and coordinate further
Host changes with its existing migration owner.

Final local continuation: 49/50 source capabilities completed; only L04 awaits
delivered-source hosted CI results/timings. Windows BuildOnly 82d9c8d34624e37cc8b2-local
passed actual packaged Host/native smoke, all six checks, old DB schema 1 to 20,
normal native IPC and visible session title/history. The same frozen web identity
passed recovery/Reload and the four 1280/800 light/dark captures. Parent verified
all retained proof/log hashes and opened all captures. Independent staged Android
JavaScript export 3387 modules/12MB and final normal mobile tsc-rs passed. Final
Node script fixtures 162/162, updater Python 68/68, core 13/13, offline eval 30/30;
normal desktop/core types, Host boundaries 47 files/headless 851 inputs and workflow
lint passed. These counts belong to their named checks and are not all-product
runtime acceptance. Installed/public-release inclusion remains unknown.

## Windows local execution continuation (2026-10-28)

Owner decisions in the same version/structure conversation: "tamam bunuda yapalım"
(approve proposed heavy Windows self-hosted execution), then "yok ama kurabilirsin yetki veriyorum"
(authorize creating a dedicated VM). This affects CI infrastructure, not deferred
product accounts/company deployment. T2 scope includes routing, immutable machine
admission, protected runner/profile/cache roots, VM/tools/session helpers and
reviewed packaging paths. See docs/reference/windows-runners.md.

CI Host six Windows shards and native checks, reusable desktop packaging and
release-cache support explicit opt-in; PRs stay hosted. Shared queue max retains
pending siblings, existing exact-source Check/signature/smoke gates stay required.
The machine-owned hook rejects untrusted jobs before steps; labels/YAML are only
routing. Clean checkouts retain dedicated external caches; no owner credentials or
node_modules are shared. Source fixtures do not establish live runner activation.

Actual operator evidence: temp/verification/2026-10-28-windows-runner/. Elevated
Hyper-V creation, verified Windows ISO, new Gen2 VM and real guest boot/admin/OOBE
proof passed. Evaluation activated for90 days. Guest tools/runner activation and
delivered-source CI acceptance are tracked separately in that continuation report.
Shared HEAD moved from d8bf868... to83053d6b... through concurrent work; this session
has not staged, committed, pushed or changed branches. Preserve concurrent edits.
