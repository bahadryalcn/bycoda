# Contributing to bycoda

Bug reports, ideas, documentation improvements, and code contributions are welcome.
Share the information you have; a complete proposal or reproduction is not required
to start a discussion. This guide applies to the
[bycoda repository](https://github.com/bahadryalcn/bycoda).

## Development environment

Install Node.js, the pnpm version pinned in [package.json](package.json), Rust,
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

- `src/app/`: application composition, startup, and desktop shell.
- `src/features/`: feature interfaces, models, and tests.
- `src/integrations/harness/`: provider adapters and shared agent contracts.
- `src/shared/` and `src/platform/`: shared components and platform bridges.
- `src-tauri/src/`: native Rust application.
- `host/`: local and remote host runtime.
- `scripts/`: build, packaging, and maintenance tools.

See the [repository layout reference](docs/reference/repository-layout.md) for
script groups, documentation categories, and local archive locations.

## Issues and pull requests

Use the issue templates when helpful, or open a blank issue for questions and
topics that do not fit them. Search for related discussions if convenient and link
them for context. Security vulnerabilities should follow [SECURITY.md](SECURITY.md).

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
and exclude vendored code. Rust formatting uses `cargo fmt --all`.

Use Oxlint and Oxfmt for repository linting and formatting; do not use ESLint or
Prettier as fallback development tools. The application's file editor currently
uses Prettier separately for format on save, so its runtime dependency must remain
until that editor integration is replaced.

The broader validation commands are:

```sh
pnpm run check:web
pnpm run check:rust
pnpm run test:host
node scripts/i18n/check-locales.mjs
node scripts/checks/check-repository-hygiene.mjs
```

For UI or native changes, check the relevant runtime when available. Distinguish
source tests from packaged or installed application checks and identify any
unverified behavior.

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
