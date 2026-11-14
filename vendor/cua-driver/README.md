# cua-driver integration provenance

The optional second Computer use driver targets the Cua Driver release
`cua-driver-rs-v0.49.11` from https://github.com/trycua/cua (MIT, `LICENSE`
copied unchanged).

- Setup: `scripts/setup/cua-driver.mjs` (pinned archive names and upstream SHA-256).
- MCP client: `host/desktop/cua-driver-client.ts`.
- Command adapter: `host/desktop/cua-driver-runner.ts`, which serves the same
  `desktop.*` operations as agent-desktop so permission modes, app approvals,
  physical-input grants, receipts, audits and Stop stay shared.

No upstream executable is checked into this directory. Preparing downloads the
pinned Windows archive from the GitHub release, rejects any SHA-256 other than
the upstream `SHA256SUMS` value, extracts it with Windows' bundled `tar.exe`
and keeps only `cua-driver.exe`, `cua-driver-uia.exe`, `cua-cursor-theme.exe`,
`LICENSE` and `THIRD_PARTY_NOTICES.md`. A `manifest.json` records every file's
hash; read-only discovery rechecks all of them. The bundle lives under
`~/.bycoda-build/helpers/cua-driver/<version>/<platform>-<arch>/`, and
`node host/package.mjs` copies a prepared bundle into the Host package as
`cua-driver/`. Preparing never enables control or changes Host settings.

The Host runs `cua-driver mcp` as one long-lived stdio child with
`DO_NOT_TRACK=1`, `CUA_TELEMETRY_ENABLED=false` and
`CUA_DRIVER_DISABLE_RUN_SCRIPT=1`. A Stop, settings change or cancelled call
kills it; refs carry the process generation so a restart makes earlier refs
foreign. Actions use background UI Automation delivery by default and
`delivery_mode: "foreground"` only under the existing physical-input grant.

Not mapped yet: `wait`, `hover`, `drag`, `check`, `uncheck`, `collapse`,
`scroll-to` and `focus` return an unsupported refusal without dispatch.
Windows only in this release; macOS and Linux need their own permission flows.
