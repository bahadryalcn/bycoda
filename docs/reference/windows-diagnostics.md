# Manual Windows file diagnostics

`Manual Windows file diagnostics` is an optional workflow for one named source test file on Windows. It is independent of required Windows CI, native package smoke and installed-app acceptance. It does not build, install, update, sign or publish an app/Host, stop a service, clean a checkout, change credentials or accept an arbitrary shell command.

```sh
node scripts/checks/windows-diagnostics.mjs --suite host --file host/session-authority.test.ts
node scripts/checks/windows-diagnostics.mjs --run --suite scripts --file scripts/checks/context-metrics.test.mjs --output temp/verification/windows-diagnostics/unique-run
```

The default prints a plan. `--run` requires Windows and a new output directory under ignored `temp/verification/`; existing evidence is preserved. Timeout defaults to 120 seconds and is explicitly bounded between 1 and 600 seconds. Processes use argument arrays with `shell: false` and hidden windows. Relative paths are validated against their family and resolved inside the actual checkout; traversal, shell syntax, missing/non-file targets and unknown switches/suites are rejected.

| Suite               | Allowed file                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| `host`              | One `host/**/*.test.ts`                                                              |
| `web`               | One `src/**/*.test.ts`                                                               |
| `scripts`           | One `scripts/**/*.test.mjs`, `.test.cjs` or `.github/scripts/**/*.test.cjs`          |
| `package-contracts` | `scripts/build/host-inputs.test.mjs` or `scripts/release/release-candidate.test.mjs` |
| `local-update`      | One `scripts/local-update/test_<name>.py`                                            |

The Vitest child configures an exact single-file include and verifies the installed Vitest discovery selects exactly that file before executing it. A missing, skipped, failed or unhandled-error run cannot become success. Node and Python recipes also select exactly one allowlisted file. Package-contract diagnostics inspect source/fixture contracts; they do not prove any produced or installed package works. Tests use their existing isolation and fixture rules; never select destructive production-data tests for this entry.

Every completed invocation writes `diagnostic.json`, `stdout.log` and `stderr.log`. The receipt records source SHA/dirty state, exact selected-file and manifest/config hashes, command arguments, timeout, start/finish time, raw-log names and exit/signal/error state. Input drift during execution is reported as `source-drift`; timeout and unavailable executables remain explicit failures. The source identity describes this working-source check, with installed-build inclusion marked unknown. Raw test logs should contain fixture data; review them before external sharing.

The manual workflow runs only on trusted `main`, checks out the exact workflow SHA with nonpersisted credentials, uses the existing package-manager-pinned setup action, and retains logs/source receipts for seven days. Its inputs are passed through environment variables to the validator, never interpolated into shell code. It has only `contents: read` and does not replace or rename the required aggregate CI check.

Local implementation checks:

```sh
node --test scripts/checks/windows-diagnostics.test.mjs
```

The workflow reuses the verified official [checkout](https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262) and [artifact upload](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02) commits already used by normal CI. Hosted workflow execution is separate from the local runner/fixture checks.
