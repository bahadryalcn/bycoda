# Contributing to bycoda

Bug reports, ideas, documentation improvements, and code contributions are welcome.
Share the information you have; a complete proposal or reproduction is not required
to start a discussion. This guide applies to the
[bycoda repository](https://github.com/bahadryalcn/bycoda).

## Development environment

Install Node.js 22.12 or newer (`.nvmrc` selects 22), the pnpm version pinned in [package.json](package.json), Rust,
and Tauri's platform build prerequisites. To run agent sessions, install and
authenticate a supported provider CLI.

```sh
pnpm install --frozen-lockfile
pnpm run tauri dev
```

Use `pnpm run setup:linux:deb` for Debian/Ubuntu native dependencies or
`pnpm run setup:linux:fedora` for Fedora. For Windows/macOS packaging and local
installation, use the [shared update coordinator](docs/local-update.md).

## Repository layout

- `apps/desktop/`: desktop main and quick-composer entry modules.
- `packages/core/`: portable helpers with explicit exports and independent checks.
- `src/app/`: application composition, startup, and desktop shell.
- `src/features/`: feature interfaces, models, and tests.
- `src/integrations/harness/`: provider adapters and shared agent contracts.
- `src/shared/` and `src/platform/`: shared components and platform bridges.
- `src-tauri/src/`: native Rust application.
- `host/`: local and remote host runtime.
- `scripts/`: build, packaging, and maintenance tools.

See the [repository layout reference](docs/reference/repository-layout.md) for
script groups, documentation categories, and local archive locations.
Workspace boundaries and staged migration are described in
[Platform foundation](docs/reference/platform-foundation.md). Optional staged
checks, hooks, advisory PR reports and Linux retry commands are documented in
[Repository operations](docs/reference/platform-operations.md).

## Issues and pull requests

Use the issue templates when helpful, or open a blank issue for questions and
topics that do not fit them. Search for related discussions if convenient and link
them for context. Security vulnerabilities should follow [SECURITY.md](SECURITY.md).

Write reports in the language you are comfortable with. Only the main description
is required: an early idea, an uncertain severity, or a bug without a complete
reproduction is welcome. The bug form offers severity, affected area, frequency,
impact, and environment fields; add what you know and update the issue later.
Questions and general feedback have their own form. Never post credentials or
private project/conversation data in logs or screenshots.

### Classification and triage

Labels let contributors filter the backlog without prescribing a title format:

| Label family                          | Purpose                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `bug`, `enhancement`, `question`      | Kind of report                                                                |
| `severity: critical`                  | Widespread outage or unrecoverable data loss                                  |
| `severity: high`                      | Lost work, unintended actions, or a core workflow blocked                     |
| `severity: medium`                    | Incorrect behavior with a workaround or limited scope                         |
| `severity: low`                       | Visual, wording, or minor inconvenience                                       |
| `area: …`                             | Affected subsystem; multiple areas are allowed                                |
| `status: …`                           | Needs triage, needs info, confirmed, in progress, or blocked                  |
| `priority: p0` through `priority: p3` | Maintainer scheduling decision: immediate, next available, normal, or backlog |

Severity describes impact; priority describes when to work on it. A severity
selection is an initial assessment, not a verified diagnosis, release promise,
or automatic priority. Unknown severity stays unset. Maintainers may revise it
as evidence arrives. Feature requests and questions do not need bug severity.

The Issue triage workflow marks new reports `status: needs-triage` and maps exact
bug-form severity and area choices to labels. It accepts blank issues too. It
never assigns priority, closes reports, posts replies, or overwrites existing
classifications. Later body edits do not rerun classification; ask for reassessment
in the issue, and a maintainer can change labels directly. For example, filter
with `is:issue is:open label:"severity: high"` or
`is:issue is:open label:"area: queue"`.

During triage, identify the impact and affected areas, request only the missing
details needed to proceed, and replace the current status label rather than
accumulating conflicting states. Keep one severity and one priority at a time.
Use `status: confirmed` only after checking the stated reproduction; source or
mocked-component evidence alone does not prove installed-app or live-host behavior.
Use an assignee for active ownership and milestones only for agreed delivery scope.
Leave scheduling priority unset until a maintainer chooses it. Link related reports
before marking duplicates, and state the remaining blocker when work is blocked.

The label catalog lives in [.github/issue-labels.json](.github/issue-labels.json).
After the workflow is on the default branch, maintainers can run **Issue triage**
manually from Actions to create missing catalog labels. Existing labels and their
customized colors/descriptions are preserved. Form/workflow changes take effect
after being reviewed and delivered to the default branch.

A pull request does not need a linked issue, a prescribed title format, or a fixed
size. Explain the problem and resulting behavior so reviewers can follow the change.
Keep related changes together; separate unrelated work when it makes review easier.
For larger changes, an early discussion or draft pull request can help clarify scope.
Work in progress is welcome when clearly marked.

Use the PR template as a guide. Keep its merge checklist; optional sections can be
removed when they do not apply. Screenshots are
helpful for visible changes, but are not required for every UI edit. Include known
limitations or compatibility considerations when relevant. Respond to review
feedback constructively; maintainers may request changes before merging.

## Validation

Tests relevant to the change and all required CI checks must pass for the latest
revision before a pull request is merged. Add or update regression coverage for
behavior changes where appropriate, and describe test commands and results in the PR.
Draft PRs may have pending or failing checks while work is in progress.

If you cannot run a required check locally, explain why and have it completed in
CI or by a maintainer before merging. Explaining a missing check does not waive it.
Documentation-only changes need proofreading and link checks; the PR's required
CI checks must still pass. Additional manual checks should match the change's scope.
Run `pnpm run format` to format supported source, configuration, and documentation
files with Oxfmt, including the host. Use `pnpm run format:check`
to check formatting without writing files, and `pnpm run lint` to run Oxlint.
`pnpm run lint:fix` applies safe lint fixes. These commands respect Git ignore rules
and exclude vendored code. Rust formatting uses `cargo fmt --all`. The repository
is LF-only (`.gitattributes`); `docs/reference/ui-components.md` is generated and
excluded from Oxfmt, so regenerate it with `pnpm check:ui-catalog --write`.

Use Oxlint and Oxfmt for repository linting and formatting; do not add other
linters or formatters as fallback development tools.

For daily iteration, `pnpm check:plan` previews affected CI gates and bounded
adjacent checks; `pnpm check:changed` runs those local checks with explicit
limits. It never installs dependencies or represents complete CI. Full CI is
the GitHub `CI` workflow, including its final **Check**; manual dispatch and
main pushes exercise every required platform. See the
[testing guide](docs/reference/testing.md) and [CI policy](.github/CI.md) for the
single command/scope/evidence inventory.

The broader validation commands are:

```sh
pnpm run check:preflight
pnpm run check:web
pnpm run check:rust
pnpm run test:host
node scripts/i18n/check-locales.mjs
node scripts/checks/check-repository-hygiene.mjs
```

Host CI splits the suite across isolated runners: six Windows shards, two macOS
shards, and one Linux shard. Files remain serial inside each runner because these
tests launch real child processes. To reproduce one shard locally, use
`pnpm run test:host --shard=1/6`. Keep all shards passing; a passing shard alone is
not full Host acceptance. `node scripts/checks/check-host-test-shards.mjs 6`
checks the actual Vitest partition without running test modules. CI saves a JSON
report per shard and validates Host packaging once per operating system.

For UI or native changes, check the relevant runtime when available. Distinguish
source tests from packaged or installed application checks and identify any
unverified behavior.

The [platform foundation reference](docs/reference/platform-foundation.md)
records the staged module, release, account and organization architecture. Its
proposed directories and services are not implemented product capabilities.

Offline model-behavior checks use `pnpm eval:check` (normal tsc-rs) and
`pnpm eval:offline`; reports use
`pnpm eval:report`. These use sanitized fixtures and production prompt/schema
definitions. They do not call a paid provider or prove live model quality.
`pnpm check:quality-report` reports static dependency usage for review; dynamic,
platform and generated consumers must be checked before removal. Dependency
patches need an exact version, reason, reproduction/regression, upstream link
and removal condition; do not import an unrelated patch collection. No hooks or
external review/cache service are installed by these commands.

## Documentation and repository hygiene

Read the [file and artifact policy](.artifact) before adding or relocating files.
Keep maintained files in their established directories and local task outputs under
the appropriate ignored `temp/` subdirectory.

Write documentation, issue templates, and contributor guidance in English.
Application translation catalogs may contain their target languages.
Keep source, meaningful tests, product assets, and current usage/technical guides.
Exclude temporary agent notes, screenshots, test reports, benchmark outputs,
credentials, and machine-specific validation records. See
[repository hygiene](docs/reference/repository-hygiene.md).

Preserve attribution when importing code or pull requests from other projects.
See [CREDITS.md](CREDITS.md) for upstream and community acknowledgments.
