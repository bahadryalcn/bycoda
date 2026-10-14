# Repository layout

The root [`.artifact` policy](../../.artifact) defines where maintained files and
local agent outputs belong. Agents must read it before creating or relocating files.

The repository groups application code by responsibility. Keep new files close
to the feature or runtime they support, and use the existing boundaries before
adding another top-level folder.

## Application and runtimes

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
belong in `tests/browser/`; host and native tests stay with their runtimes.

Browser fixture builds use `tests/browser/vite.config.ts` and
`tests/browser/vite.composer.config.ts`. The root `playwright.config.ts` remains
the default browser test entry point; composer scenarios use
`tests/browser/playwright.composer.config.ts`:

```sh
pnpm exec playwright test --config tests/browser/playwright.composer.config.ts
```

Composer fixture builds are written to `temp/build/browser-composer/`.
Playwright test outputs are written to `temp/test-results/<suite>/`.

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
