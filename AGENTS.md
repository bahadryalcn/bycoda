# Repository file placement

Read `.artifact` before creating, moving, or generating files. Follow its maintained
source/documentation locations and keep task plans, TODOs, research, logs, screenshots,
and one-time helpers in the appropriate ignored `temp/` subdirectory. Preserve useful
retired files in `temp/archive/`; do not scatter agent outputs in the root or product
documentation. Update dependent paths when moving maintained files and run
`node scripts/checks/check-repository-hygiene.mjs` before committing.

# bycoda local app/host updates

For local Windows PC and MacBook build/install work, read `docs/local-update.md` and use `scripts/update-local.ps1` as the shared coordinator. Do not recreate ad-hoc build folders, SSH build commands, service swaps, or installer helpers. Use `-Plan` to review the selected machines/options and `-InstallOnly` to reuse this pipeline's already-built package.

The coordinator freezes source once, builds both machines in parallel, and records per-stage logs/timings. Keep its persistent pnpm/Cargo/runtime caches. Use the default local mode for local installs; `-Release` is the explicit full-optimization option. Do not repeatedly build to chase edits from another session.

Host and app idle gates are separate. Never treat a failed database read as zero active sessions, kill active work to speed an update, or claim that a scheduled install is completed. Read `-Status` and the recorded artifacts before reporting success. Keep existing host services, databases, credentials, and rollback files intact. Do not expose auth state/signing keys or infer public-release/commit/push authority from a local update request.

Every build is archived in `~/.bycoda-build/packages/` as `bycoda_<version>_<YYYY-MM-DD>_...`;
hand users installers from that folder, never from ad-hoc copies or Cargo targets.

Honor requests to stop before building: validate the scripts/tests/plan and report that real build/installation remains unverified. On Windows, all shell tool calls use `tty=true`; helpers and child commands stay hidden.

Use the packageManager-pinned pnpm 12 version. Never run npm ci for local updates. Reuse existing node_modules unless package.json changed; missing node_modules requires an initial pnpm install. ForceBuild does not force dependency installation.

# File placement and agent outputs

Read the root `.artifact` policy before creating, moving, or generating any file. It lists where maintained source/docs live and where local agent outputs go.

Agent outputs (plans, TODO lists, audit reports, research notes, one-time scripts, check logs, screenshots) are never committed. Put them under the ignored `temp/` tree using a short task ID such as `2026-10-09-code-audit`:

- `temp/local/<task-id>/` for plans, TODOs, research, scratch data, and a short `README.md` describing purpose, origin, and reuse limits.
- `temp/verification/<task-id>/` for tsc/vitest/cargo logs, benchmark results, and visual review captures.

Do not write such files into `docs/`, the source tree, or the repository root, even if a legacy `.gitignore` pattern would hide them. Confirm with `git check-ignore <path>` and never use `git add -f`. Run `node scripts/checks/check-repository-hygiene.mjs` before committing.
