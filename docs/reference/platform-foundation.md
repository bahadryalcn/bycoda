# Platform foundation and repository structure

Status: local source implementation continued on 2026-10-28, including working
workspace packages, complete browser CI partitions, reusable desktop packaging,
candidate channels and optional repository/mobile tooling. Hosted execution and
installed application acceptance are separate from these source capabilities.
Authentication and organization services remain deferred.

Current scope, clarified by the owner on 2026-10-27: repository structure, module
boundaries, build/CI, tests, lint, packaging and evaluations. Account/company work
is deferred. Managed-cloud versus self-host is not a decision or blocker for this
structural work. Company research below is retained for later, not an active plan.

Baseline: bycoda `0a42b1ab4fd891ccec5ca0fa238d7356b396b13c` plus the explicitly
listed local changes. Upstream comparison: a reviewed reference project snapshot.
Do not infer a runtime feature from a directory, dependency, plan or policy type.

## Outcome and existing plans

Improve the existing application's code organization and development/release
workflow without losing provider integrations, local data, drafts, device access
or recovery. Prioritize real contracts/runtime boundaries, reusable build outputs,
focused quality checks and clear package ownership.

This proposal complements the existing Host authority/WS plan in
`temp/local/2026-10-27-host-architecture-plan/PLAN.md` and its W00-W11 contracts,
and retains the Team product plan in `temp/local/2026-10-18-team-platform/` as
deferred background only. Those local plans were refreshed during this review;
neither is implementation evidence. The Host plan remains the owner of
transport and execution migration. This document adds release/module boundaries
without introducing a competing execution engine.

The previous accountless personal-use behavior is preserved. No login, organization,
billing, provider or deployment-model decision is required for the current scope.

## What the reference directories actually provide

| Upstream area                                        | Concrete function                                                                              | Existing bycoda counterpart and decision                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/`                                              | Desktop, server/CLI, web, Expo mobile and marketing deployables.                               | `src/`, `host/`, `src-tauri/`, separate nested `mobile/`. Separate existing deployable boundaries incrementally; preserve current mobile repository ownership.                                                 |
| `packages/`                                          | Private contracts, client runtime, provider and source-control packages with explicit exports. | Shared code already exists under `src/shared/` and `src/integrations/harness/`; the Host imports some source directly. Adopt dependency boundaries, then extract actual multi-consumer packages incrementally. |
| `evals/`                                             | Real-model tool-choice and title regressions with graders and controls.                        | Unit, Host and browser tests exist; no comparable maintained model-behavior harness was found. Add sanitized cases and deterministic graders first; paid runs remain explicit and budgeted.                    |
| `oxlint-plugin-<name>/`                              | Project-specific AST rules for permission, testing, React/native and UI conventions.           | Oxlint/Oxfmt and an external React Hooks plugin already exist. Add a bycoda rule only for a concrete recurring invariant, with positive/negative fixtures and a migration baseline.                            |
| Oxc                                                  | Built-in toolchain/plugin namespace, not a missing reference source directory.                 | Already used through Oxlint/Oxfmt; continue the pinned `tsc-rs` checking contract. Vite+/Effect adoption is not a prerequisite.                                                                                |
| `packaging/aur/`                                     | Arch recipes for already-built stable/nightly AppImages.                                       | Tauri packaging and local/release scripts already exist. Add distribution adapters only for supported distribution channels; this does not reduce native compilation.                                          |
| `patches/`                                           | Exact-version package-manager dependency patches.                                              | `vendor/` is not equivalent to a patch registry. Add only reproducible required fixes; record dependency version, reason, test, upstream issue and removal condition.                                          |
| `infra/relay/`                                       | Account/environment discovery, tunnel allocation, connection bootstrap and notifications.      | Local pairing, SSH/tunnels and Host tools exist. Account/control-plane work is deferred. Retain the infrastructure separation as research only.                                                                |
| `infra/task-cache/`                                  | Authenticated remote build/test-result cache, separate from product data.                      | Persistent local/pnpm/Cargo caches exist. Add remote result caching after deterministic inputs, OS/architecture segregation and trusted writers are proven.                                                    |
| `.macroscope/`                                       | Configuration for an external PR reviewer, including scoped policies and budgets.              | Existing AGENTS/cards and checks provide guidance; the directory alone supplies no review service. Choose an actual review integration before adding service-specific configuration.                           |
| `.vite-hooks/`                                       | Fast staged-file formatting, not a full release on every commit.                               | Optional bounded staged checks fit; authoritative full checks stay in CI. Do not install or activate hooks silently.                                                                                           |
| `native/`                                            | Specific native monitoring/capture/secret/terminal helpers.                                    | Tauri/Rust already owns native capabilities. Add helpers for verified gaps; keep platform ownership explicit.                                                                                                  |
| `.repos/`                                            | Vendored upstream reference source, excluded from release builds.                              | Usually unnecessary; fetch focused upstream source for research instead of expanding the production checkout.                                                                                                  |
| `.claude/`, `.cursor/`, `.vscode/`, `.devcontainer/` | Development/editor/environment integration.                                                    | Optional contributor conveniences, not company authentication or runtime reliability. Keep secrets and individual settings out of shared configuration.                                                        |

<details>
<summary>Deferred background: account/company research</summary>

reference cloud login is not evidence of a company platform. Its reviewed relay maps a
verified Clerk subject to `userId`; environment links/allocations are user-scoped.
No company tenant, membership, role, billing, SAML or SCIM implementation was found
in the 55 production TypeScript files under the reviewed `infra/relay/src`.
Separate environment pairing/scopes and guest sharing do exist. This was reviewed in its principal mapping, storage schema and environment
authorization sources.

## Current bycoda implementation and gaps

| Boundary        | Current code evidence                                                                                                     | Required company addition                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| User identity   | `src-tauri/src/account_identity.rs`, `host/providers/provider-accounts.ts` identify provider profiles.                    | A bycoda account/session authority; provider profiles must not be reinterpreted as company users.                                        |
| Device access   | `host/store.ts` stores hashed paired-device tokens and rechecks revocation; `host/server/http.ts` authenticates dispatch. | Separate organization/member/device principal, enrollment, policy version and resource capabilities; never fall back to an owner token.  |
| Company policy  | `host/security/team-access.ts` explicitly is not wired to RPC or an identity verifier.                                    | Trusted evidence verifier, durable grants/revocation, effect-time authorization, approval consumption and execution integration.         |
| Tool delegation | `host/mcp/mcp-tokens.ts`, `host/execution/runtime-log-tools.ts` provide scoped expiring grants.                           | Bind scopes to current membership/resource authority and propagate offboarding.                                                          |
| Storage         | Local Host SQLite and desktop persistence; exact environment/session identity.                                            | Tenant-aware company metadata database, repositories, isolation tests and migrations. Keep personal data local unless explicitly shared. |
| Secrets         | Desktop remote bearer tokens are stored in `remote-machines.json` with access restrictions; mobile uses Expo SecureStore. | Native protected credential adapters and a verified migration. Do not claim all current desktop tokens already live in an OS vault.      |
| Recovery        | Durable command identities/receipts and remote-session protocol.                                                          | Organization-scoped revisions, outbox, revocation checkpoints and restore quarantine. Do not resurrect old grants after restore.         |

Existing project grouping RPC names containing `organization` describe project
layout, not company tenancy. `TeamPermission` currently covers terminal/SFTP/
forwarding policy; it is not a complete permission registry for all product tools.

</details>

## Target ownership and code boundaries

The read-only `node scripts/checks/repository-graph.mjs` report inventories
production `src/`/`host/`/`apps/`/`packages/` import edges and literal Rust embeds. `--json` includes
consumers, source locations, owner groups and unresolved/computed imports. It
does not execute product modules, traverse the separate mobile repository or
declare unreferenced code unused. Review dynamic resources and unresolved edges
before narrowing a build or check boundary.

Portable contracts/runtime and Host domain/transport/storage extraction are
already being implemented by the Host runtime workstream. Its
[runtime reference](host-runtime.md) and the existing transitive boundary checks
remain authoritative. This workstream adds build/test orchestration around those
boundaries; it does not create a second DTO/schema authority. The first working
workspace slice is `packages/core`: JSON text, bounded concurrency and session
title helpers used by desktop, Host and mobile through canonical public exports.
Old source paths are compatibility re-exports. `apps/desktop` owns the main and
quick-composer entry modules used by the root HTML; implementation remains under
`src/` while the active Host migration continues. Package/desktop tsc-rs projects,
transitive export checks, workspace lock inputs and source graphs enforce this
slice. This is an incremental boundary, not a completed relocation of every app.

The selected Host owns files, agent processes, terminals, Git, accepted task runs,
command receipts and authoritative session history. Clients own drafts, selection,
presentation and cached projections. A disconnected viewer must not create a second
executor. Separate contracts, platform adapters, transports, domain services and
storage without changing existing operation authority.

The immediate extraction remains within the Host plan's approved roots:

```text
src/shared/model/host-contracts/    schemas, DTOs and method/capability policies
src/shared/lib/host-runtime/       framework-neutral command/sync behavior
src/platform/                     injected desktop/mobile/browser adapters
host/bootstrap/                   composition and lifecycle
host/transport/                   authenticated HTTP/WS dispatch adapters
host/domains/                     feature services
host/storage/                     repositories and durable transactions
```

Create those modules through working vertical slices, keeping compatibility facades
until consumers and checks migrate. Contracts/runtime must not import React, UI,
Tauri/Expo, filesystem, database or Host implementations. Services must not depend
on HTTP request/socket objects. Public exports and transitive import checks enforce
boundaries; moving files alone cannot enforce them.

The current working additions are:

```text
apps/desktop/        real main/quick-composer entry modules and typecheck
packages/core/       canonical portable helpers, explicit exports and tests
evals/               offline graders, sanitized cases and explicit paid-run gates
```

Further destinations, when independently justified by actual consumers, are:

```text
apps/
  desktop/          current React/Tauri application
  host/             current Host runtime and CLI
packages/
  contracts/        versioned schemas and capability registry
  client-runtime/   command, synchronization and lifecycle policy
  provider-core/    existing provider ports/adapters, migrated by consumer
infra/              build/cache infrastructure when justified by actual use
evals/              sanitized real-model regressions and deterministic graders
packaging/          actual distribution adapters and release manifests
patches/            only active, justified versioned dependency fixes
```

The additional destinations above are not a request to create empty packages.
Mobile remains a separate repository until its owner explicitly migrates history,
dependency installation, native build paths and shared-source contracts. Before
introducing new roots update `.artifact`, workspace/package manifests, lockfiles,
tsc-rs/Vite/esbuild/Cargo paths, CI filters/caches, snapshot inputs, licensing,
documentation and the feature cards. Each package must have a real consumer,
explicit exports, a dependency owner and a build/test boundary. Do not maintain
two competing schema registries under old and new paths.

<details>
<summary>Deferred: account and company vertical slices</summary>

The owner explicitly deferred this work. These retained ideas are not current
implementation tasks or prerequisites for the structural migration.

1. Prove desktop and mobile login/logout with a real identity-provider test tenant:
   system browser, code flow with PKCE/state/nonce as applicable, exact callback
   validation, secure refresh storage and issuer/audience/signature validation.
   No embedded native client secret. Keep a provider adapter; prior Clerk preference
   is a candidate integration to prove, not current support evidence.
2. Implement user, organization, membership, invitation and ownership-transfer
   lifecycle with explicit revisions, current membership verification and webhook
   deduplication/reconciliation. One user may hold several organization memberships.
   Team/group belongs within an organization; AI Crews remain separate.
3. Share project metadata with a second user and prove tenant isolation before
   enabling machine access. For company metadata, require tenant context in every
   repository/query, cache key, event, export and worker. Use tested PostgreSQL RLS
   as additional defense, with a non-owner/non-BYPASSRLS application role and
   transaction-local context. Test background jobs as well as HTTP handlers.
4. Enroll an isolated test Host using operator consent, host public-key proof,
   exact project-root binding and short-lived device-bound capabilities. Start
   with read-only access. A company project listing never grants terminal, Git
   writes, provider execution, SSH, SFTP or forwarding.
5. Add assignments/comments/reviews as company metadata and Host projections.
   Human comments are not automatic agent instructions. Reviews bind to immutable
   diff/artifact revisions; editing the artifact invalidates old effect approval.
6. Enable terminal/agent effects only after lease expiry/revocation, in-flight
   streams, process-tree control, retries and unknown outcomes pass. Maintain
   host-side effect authorization; browser disconnect is not membership revocation.
7. Add seats/billing, usage admission, retention/export/deletion and operational
   recovery. An identity membership, admitted seat and project grant are separate
   states. Later Business slices cover SSO/SCIM, policy, provisioning and customer
   deployment requirements; they are not included by installing a login SDK.

Native login reference: [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252).
Tenant defense reference: [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
No service was provisioned or production identity configuration changed here.

</details>

## Release and quality transition

Current commands and evidence categories are documented in
[Testing and evidence](testing.md); runner selection comes from
`tests/browser/suites.json`. CI policy, selected jobs and the aggregate result
are described in [the CI guide](../../.github/CI.md). The diagnostic
[guide](../guides/diagnostics.md) keeps source, app, Host, provider and mobile
identity separate.

Release policy and operator commands are defined in [Releases](releases.md).
Stable/nightly/preview candidates bind immutable source SHA, exact successful full
CI, target/version and file hashes. Desktop packaging uses the reusable workflow;
local frozen packages are explicitly local evidence and cannot pass the public
publisher. Windows/macOS packaging requires actual package smoke receipts,
including retained diagnostics. Owner-controlled publication remains separate.

| Slice                      | Local implementation                                                                                       | Acceptance boundary                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| B01 Host CI                | Windows 6/macOS 2/Linux 1 shards; serial files, complete selection and unique receipts                     | Hosted results/timings require delivery                                            |
| B02 Install inputs         | Workspace manifests, lock/config/patch inputs; version-only dependency reuse                               | Cached exact pnpm executable is selected without global changes                    |
| B03 Component selection    | Host-only builds skip web/native; immutable component manifests                                            | Missing/inconsistent provenance is rejected                                        |
| B04 Desktop packaging      | Reusable target workflow, hashed native/Host outputs and old-DB/real DOM smoke                             | Build, isolated launch, installation and publication are distinct                  |
| B05 Candidates             | Stable/nightly/preview source/channel policy; nightly is explicitly opt-in                                 | Exact full CI required; no automatic public publication                            |
| B06 PR preview             | Opt-in unsigned producer and separate trusted archive validator                                            | Untrusted PR bytes are never executed by the privileged validator                  |
| B07 Output cache           | Opt-in deterministic repository inventory cache, full inputs/toolchain/OS/arch and hashed output           | Trusted main writes; forks cannot populate it; no test-success caching             |
| B09 Linux retry            | Opt-in bounded Ubuntu HTTPS source fallback using a temporary source file                                  | Fake-APT tests do not establish live mirror performance                            |
| Q01 Structural rules       | Package export/transitive checks, Host neutral/headless boundaries, advisory reports                       | Existing Host migration owns contract/domain/storage authority                     |
| Q02 Evaluations            | Sanitized production-imported cases and 30 offline grader tests                                            | Synthetic baseline/control are not real-model quality evidence                     |
| Q04 Staged checks          | Index-content format/lint and explicit hook installer                                                      | Hook configuration is unchanged until an owner invokes installation                |
| M01-M04 Mobile/diagnostics | Separate-repo fingerprint, guarded EAS preview, virtual-device showcase and exact-file Windows diagnostics | EAS, installed virtual devices and hosted Windows runs require their own execution |

The browser manifest covers 1498 default cases and 106 explicit variant cases in
ten complete, disjoint full-CI partitions. PRs retain the focused 28-case smoke
selection. Discovery establishes selection coverage; a local representative run
does not establish execution of every case. Optional commands and their effects
are documented in [Repository operations](platform-operations.md).

reference's shared JS bundle reduces duplicate JS compilation, but bycoda embeds assets
in Tauri and still needs native compilation/linking and platform packaging. Existing
Windows/macOS builds already run in parallel; local mode already disables LTO and
uses incremental compilation. Preserve those optimizations. Measure native work
before changing release optimization or adopting a paid remote runner/cache.

## Acceptance and delivery boundaries

Historical first-slice checks for B01/B02: 61 local-update fixture tests, partition coverage over
236 Host files, a six-file/two-shard Windows sample with 53 passing tests, focused
format/lint and repository hygiene. Evidence lives under
`temp/verification/2026-10-27-platform-foundation/` and
`temp/verification/2026-10-27-ci-shards/`. This is source validation, not new CI
duration, macOS/Linux execution, package installation or a production acceptance.

The 2026-10-28 continuation is recorded in
`temp/verification/2026-10-27-platform-remaining/integration.md`, including normal
desktop/core types, current Host boundary coverage, final helper regression
results, immutable Windows package identity and isolated runtime evidence.
These working-tree changes remain uncommitted; installed/public-release inclusion
is unknown. A hosted run must use the delivered source SHA and workflow revision.

<details>
<summary>Deferred: company acceptance requirements</summary>

These requirements do not block the current repository/build/tooling work.
The minimum company pilot is two real users across two organizations, desktop and
mobile native login, invite/accept/revoke, denied cross-tenant reads/writes/events/
exports, denied stale grants, an offline/reconnecting Host, duplicate/out-of-order
webhooks, membership revocation during active streams/effects, restore after revoke,
and local personal use after logout/cloud outage. Secrets, private transcripts and
source code must not enter logs, eval captures or the cloud by default.

Before public company claims, separately prove backup/restore, monitoring, bounded
queues/retries, abuse/rate limits, audit retention, deletion/export, privacy notice,
incident access and deployment rollback. Deployment model, region/domain and first
pilot identity configuration remain open; no prices or enterprise compliance
promises are established by this document.

</details>

The current shared `main` checkout has other sessions' dirty work. The Host feature
claims table was read without writes and was empty at the check; the current runtime
does not expose the claim RPC tools to this session. Other active thread/worktree
state was inspected. No claim was acquired and this card is not a lock. No branch
switch, commit, push, PR, installation, service restart or release was performed.
