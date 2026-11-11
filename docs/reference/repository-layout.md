# Repository layout

The root [`.artifact` policy](../../.artifact) defines where maintained files and
local agent outputs belong. Agents must read it before creating or relocating files.

The repository groups application code by responsibility. Keep new files close
to the feature or runtime they support, and use the existing boundaries before
adding another top-level folder.

## Application and runtimes

The workspace also has real desktop entry modules under `apps/desktop/` and
portable helpers with explicit exports, independent types and tests under
`packages/core/`. Desktop implementation remains under `src/` during migration.
`evals/` owns sanitized cases and offline graders; paid runs are explicitly gated.
`mobile/` remains a separate Expo Git repository with its own dependencies and CI.

| Directory           | Responsibility                                                           |
| ------------------- | ------------------------------------------------------------------------ |
| `src/app/`          | Application composition, startup, settings, and desktop shell.           |
| `src/features/`     | Feature interfaces, models, and their focused tests.                     |
| `src/shared/`       | Reusable UI, utilities, and application translation catalogs.            |
| `src/platform/`     | Platform bridges, including Tauri integration.                           |
| `src/integrations/` | Provider adapters and shared agent contracts.                            |
| `host/`             | Local and remote host runtime, packaging, and runtime tests.             |
| `src-tauri/`        | Native Rust application and Tauri configuration.                         |
| `tests/browser/`    | Browser test scenarios, fixtures, and test servers.                      |
| `public/`           | Assets served by the application; `public/brand/` holds product artwork. |
| `vendor/`           | Vendored dependencies with their license and upstream provenance.        |

Focused tests stay beside their source modules when possible. Browser scenarios
belong in `tests/browser/<feature>/`, named after the owning `src/features/`
folder (plus `app-shell/`, `shared-ui/` and `support/` for shared helpers); every
file of one fixture (HTML, entry, spec, Playwright/Vite configs, server) stays
together. Spec basenames are unique because suites select them by basename.
Host and native tests stay with their runtimes.

Browser suite ownership and explicit variants live in `tests/browser/suites.json`.
Use the shared runner to select the suite and preserve fixture/port/output
isolation. Legacy config paths remain compatible; the maintained selection guide
is [Testing and evidence](testing.md):

```sh
pnpm test:browser --suite composer --project chromium
```

Fixture builds remain under ignored `temp/build/`; each runner invocation writes
its own reports, traces and screenshots below ignored `temp/test-results/`.
Workspace import ownership and transitive rules are described in
[Platform foundation](platform-foundation.md).

## Scripts

| Directory or entry point                                 | Responsibility                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/build/`                                         | Platform build and packaging helpers.                              |
| `scripts/setup/`                                         | Development environment and native dependency setup.               |
| `scripts/release/`                                       | Release tooling, including version maintenance.                    |
| `scripts/checks/`                                        | Repository validation and transport smoke checks.                  |
| `scripts/i18n/`                                          | Translation extraction, catalog validation, and translation tools. |
| `scripts/local-update/`                                  | Shared local update implementation, configuration, and tests.      |
| `scripts/update-local.ps1` and `scripts/update-local.sh` | Public entry points for local app and host updates.                |

Use the [local update guide](../local-update.md) for Windows/macOS installation.
Prefer package scripts when available so contributors use the same commands as CI.

## Documentation and local files

- `docs/guides/`: setup and everyday application use.
- `docs/integrations/`: external integrations and host workflows.
- `docs/reference/`: architecture contracts, product identity, and maintenance references.
- `docs/local-update.md`: the shared local build and installation guide.
- `.github/`: contribution templates and CI workflows.
- `temp/archive/`: useful development notes and artifacts retained for later reference.
- `temp/history/`: local recovery material for earlier repository history.
- `temp/local/`: machine-specific scratch files and temporary captures.

The entire `temp/` directory is ignored by Git. It is a local archive, not an
application dependency. Keep source, tests, license notices, and assets required
by the application in their maintained directories. Build outputs and dependency
caches remain ignored in their standard locations.

See the [documentation index](../README.md) and
[repository hygiene guide](repository-hygiene.md) for related guidance.
