# Isolated Windows CI runners

This opt-in backend runs heavy Windows jobs on a dedicated local VM. GitHub
retains source selection, job results/artifacts, aggregate Check and reviewed
release candidates. A local development BuildOnly package does not become a
public release candidate through this setting.

The owner approved this continuation on 2026-10-28 with "tamam bunuda yapalım".
Mac and Linux stay hosted in this first stage. Account/company work is deferred.

## Routing and evidence

`BYCODA_WINDOWS_SELF_HOSTED` must be exactly `true` to opt in. Policy checks the
fixed repository identity, event, default branch, source SHA and workflow ref.
Missing, malformed, disabled or untrusted input retains `windows-latest`.
Every PR, including internal PRs and `pull_request_target`, is excluded from local
routing. Trusted main/manual CI, reviewed packaging and release cache jobs may
select `self-hosted, Windows, X64, bycoda-windows-isolated`.

Host shard counts and receipt variants stay unchanged. Six Windows Host pieces
run sequentially on one agent. Native checks, cache warming and desktop packaging
share `bycoda-windows-heavy`, `cancel-in-progress: false`, `queue: max`.
Default concurrency allows only one pending job and would cancel earlier siblings;
`queue: max` supports up to 100 pending jobs. Missing/cancelled shards still fail
aggregate Check. Source, hashes, signatures, actual native package smoke and
publication approval remain required. Preflight success is not product acceptance.

## Machine boundary

This repository is public. A PR can edit workflow conditions or request runner
labels, so those are routing rather than security. Use a dedicated Windows VM and
nonadministrator runner identity without the owner's provider, SSH or GitHub
profiles. A machine-owned job-start hook outside checkout rejects untrusted events
before workflow steps. It validates repository ID/name, workflow/ref, event, source
and heavy-job identity.

The fixed root is `C:\bycoda-actions`. Hook/policy, configuration and capability
records require administrator/SYSTEM ownership and restrictive ACLs. The runner
may write its work/cache/profile/log areas but cannot replace admission policy.
An ordinary owner profile or self-written marker cannot establish isolation.
Quarantine/reimage on trust or integrity failure; cleanup does not establish that
a compromised VM is safe.

Use one persistent agent interactively in the dedicated guest. Package smoke
requires a real WebView/user desktop; Session0/service packaging is rejected.
The agent is version-pinned with automatic self-update disabled. Administrator-
managed verified updates remain necessary before GitHub refuses outdated versions.
This setup does not install a bycoda app or Host service.

## Clean workspaces and warm caches

Keep checkout's normal clean behavior. Do not use the shared owner checkout,
share whole node_modules or retain stale ignored source with `clean: false`.
Verified VM-owned caches live outside checkout: separate Cargo targets for `ci`
and `release`, Cargo/rustup homes and pnpm/npm stores. Work/test data stays separate
from the owner's desktop/Host profiles.

Self-hosted jobs skip remote pnpm/Cargo cache archives over warm local stores.
Frozen pnpm installation and compiler/test commands remain active. Hosted cache
behavior stays intact. Packaging consumes the explicit verified Cargo target
without weakening source/hash/smoke checks. Measure delivered-source durations
before claiming a speedup.

## Setup and first execution

Use the maintained setup helper; Plan/Status do not register or start an agent:

```powershell
Get-Help .\scripts\setup\windows-runner.ps1 -Full
.\scripts\setup\windows-runner.ps1 -Mode Plan
```

Administrative preparation installs the verified payload/protected policy for the
dedicated guest identity. Registration consumes a short-lived registration token;
the controller's PAT/auth profile must not enter the guest. Never put tokens in
arguments, source, transcripts or reports. Run as the nonadministrator guest user
in an interactive session. Preparation, registration and Run are distinct steps.

Deliver reviewed source to main, then manually run **Verify isolated Windows
runner** on main before opting heavy jobs in. That preflight deliberately does
not require the flag. It checks protected/interactive capability, admission
rejection behavior and available toolchains, then uploads an exact-source receipt.
It does not build a product, run native smoke or publish.

Once preflight passes, enable routing:

```sh
gh variable set BYCODA_WINDOWS_SELF_HOSTED --repo bahadryalcn/bycoda --body true
```

Run full CI on the delivered commit; verify every Windows shard/native receipt,
aggregate Check and timings. Exercise a reviewed nonstable candidate and actual
Windows package smoke before stable signing. Publication retains owner controls.

For future runs to return to hosted Windows:

```sh
gh variable set BYCODA_WINDOWS_SELF_HOSTED --repo bahadryalcn/bycoda --body false
```

Changing the variable does not move already queued jobs; cancel/re-dispatch those
runs as appropriate. Cancelled results cannot qualify a candidate. A missing or
offline runner leaves selected jobs queued and never grants successful acceptance.

## Validation and activation state

Fixture tests do not prove a VM exists. Run focused setup/policy fixtures, format
checks and this workflow validation:

```sh
node scripts/checks/windows-runner-policy-lint.mjs .github/workflows/ci.yml .github/workflows/desktop-package.yml .github/workflows/release-cache.yml .github/workflows/windows-runner-check.yml
```

Actionlint 1.7.12 predates GitHub's supported `queue` property. The adapter validates
the allowed group, `queue: max` and noncancelling semantics, removes only those
validated queue scalars, then checks remaining YAML/expressions with actionlint.
It does not broadly suppress lint errors. Retire the bridge when upstream supports
the native property.

Implementation preflight: zero registered runners. The official v2.338.2 Windows
x64 ZIP was downloaded/SHA256-verified, without registration or launch on the
owner's account. This session is nonadministrator, Hyper-V management is denied
and Windows Sandbox is absent. Actual guest preparation, registration, live
preflight and exact-source hosted acceptance require the dedicated guest and
delivered source. Source preparation is not active migration.

Primary contracts: [self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners),
[runner security](https://docs.github.com/en/actions/reference/security/secure-use),
[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[verified runner release](https://github.com/actions/runner/releases/tag/v2.338.2).
See [CI](../../.github/CI.md), [releases](releases.md) and
[local updates](../local-update.md).
