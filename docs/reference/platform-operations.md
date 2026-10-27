# Optional repository operations

These entry points are explicit tools. Adding their source does not install a
hook, alter GitHub settings, start a mobile build or change a machine's APT files.
Source tests and reports remain distinct from packaged/installed/live acceptance.

## Staged source checks

`pnpm check:staged` checks the **index content**, including partially staged
files, with Oxfmt and Oxlint. It never formats, stages or overwrites working
files. Lint reads a disposable snapshot under ignored `temp/build/`; the snapshot
is removed after the check. Binary/oversized supported source and unresolved
entries require separate review. Full tests, compilation and releases are not
part of this command.

`pnpm hooks:plan` describes the opt-in pre-commit hook. `pnpm hooks:install`
explicitly sets repository-local `core.hooksPath` to `scripts/setup/hooks`;
linked worktrees share that repository setting. An existing different hooksPath
is preserved rather than overwritten. No installer is run automatically. Review
this choice before invoking it; manually unset `core.hooksPath` to return to
Git's default hook directory. The source capability was tested with disposable
indexes; this work did not enable the owner's hook configuration.

## Advisory PR review scope

`pr-review-report.yml` reads passive Git numstat data on PRs and writes a job
summary plus a short-lived JSON artifact. Production, tests, generated files,
locales, documentation and tooling remain separate. Binary lines are unknown;
renamed paths are retained and generated/test changes are not hidden. Counts
never decide eligibility or trigger labels, comments, closure, approval or merge.

For a local report:

```sh
node scripts/checks/pr-review-report.mjs --base origin/main --head HEAD --output temp/verification/review/report.json
```

No changed program is executed by the report. The optional workflow has only
read access; it is independent of required CI.

## Bounded Ubuntu HTTPS retry

The existing Debian/Ubuntu dependency helper accepts:

```sh
bash scripts/setup/install-linux-deps-debian.sh --sources /etc/apt/sources.list.d/ubuntu.sources --https-mirror-fallback
```

Fallback is opt-in and occurs only after an actual APT update/package download
failure. It creates a temporary source file, changes recognized official Ubuntu
HTTP mirrors to HTTPS, preserves suites/components/signing policy, retries once
and removes the temporary file. It never edits `/etc/apt`, disables TLS checks
or changes Fedora/DNF handling. Unknown mirrors are refused. Network operations
have bounded timeouts/retry counts, and repeated failures remain failures.
Tests use fake apt executables and disposable source files; no packages or system
configuration were installed/changed by those tests.

## Related contracts

- [Testing](testing.md): complete browser projects, CI scope and evidence types.
- [Releases](releases.md): exact-source candidates, preview/cache and package gates.
- [Platform foundation](platform-foundation.md): workspace/module boundaries.
- [Local updates](../local-update.md): frozen BuildOnly, component manifests and
  separate idle-gated installation/recovery.
- Mobile preview/fingerprint/showcase instructions live in the separate mobile
  repository and do not authorize production EAS/OTA/store submission.
