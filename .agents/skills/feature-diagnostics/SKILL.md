---
name: feature-diagnostics
description: "Change consented diagnostic log reports on the desktop: consent modes, the UI log buffer, report building and upload, the crash notice, the periodic scheduler and the Privacy setting. The upload contract belongs to packages/account-contracts; the account API client and sign-in belong to feature-account; native log collection and the crash marker are Rust."
---

# Desktop diagnostics

With the user's consent the desktop uploads redacted application logs after a crash, together
with feedback, on request and, in automatic mode, weekly. The UI in `src/features/diagnostics/`
owns consent, the UI log buffer, the report builder and sender, the scheduler, the crash
notice and the Privacy setting. Native code collects the logs and keeps the crash marker. The
feature never imports `features/account`: the app layer wires the account API in. Mobile has its
own implementation of the same contract.

## Source starts

- UI model: `src/features/diagnostics/model/` (`diagnosticsConsent.ts`, `uiLogBuffer.ts`,
  `diagnosticsReport.ts`, `diagnosticsScheduler.ts`, `diagnosticsService.ts`,
  `diagnosticsNative.ts`), `ui/` (`CrashReportNotice.tsx`, `DiagnosticsSharingSetting.tsx`),
  `hooks/useDiagnostics.ts`; public entry `src/features/diagnostics/index.ts`.
- Wiring: `src/app/hooks/useAccountPlatform.ts` starts it; `src/app/workspace/layout/WorkspaceNotices.tsx`
  mounts the notice; the setting lives in Account → Privacy and Settings → Privacy; the feedback
  dialog in `src/features/account/` sends the linked report.
- Contract: `packages/account-contracts/src/diagnostics.ts` (read-only here).
- Native commands: `diagnostics_collect_logs`, `diagnostics_clear_crash` in `src-tauri/src/`.

## Workflow

1. Decide the owner: what is collected or when a crash marker is cleared is Rust; consent,
   redaction input, upload and notices are TypeScript.
2. Keep the command names and result shapes in `diagnosticsNative.ts` identical to Rust.
3. New strings go through `t()`; new sources need a `DiagnosticSourceName`-valid name.
4. Run the focused checks below.

## Preserve

- Consent is `off | ask | auto` (`null` = never decided, behaves as ask). Off never uploads and
  discards crash markers; ask puts a notice per crash; auto sends crashes silently and weekly.
  Manual "Send logs now" and the feedback tick are explicit consent per send.
- Logs never contain conversation content. Redaction runs on the client (`composeDiagnosticLog`)
  and again on the server; home directory and signed-in e-mail are passed as values to redact.
- A crash marker is cleared only after a successful (or empty) upload, a "Don't send" or off;
  a failed send keeps it for the next start.
- Every upload has a deadline, no promise is left unhandled, and a result is one of sent,
  rate-limited, not-configured, failed or empty.
- Feedback success never depends on the log upload; a failed linked upload only adds a note.
- One scheduler per window takes a Web Lock so a second window neither duplicates a crash
  report nor a periodic one; periodic success is remembered in local storage.
- UI log lines use the contract's `formatDiagnosticLine`. Breadcrumbs (`ui.nav`, `ui.host`, `ui.rpc`,
  `ui.window`, `ui.network`) record names, codes and durations only: never params, results, error
  messages, titles or paths. Hooks live in `connections` (`tracedInvoke.ts`, `remoteHealth.ts`) and
  `src/app/workspace/control/useNavigationBreadcrumbs.ts`.
- Connected remote Hosts (at most three, 4 s each, failures skipped) are read with the Host RPC
  `diagnostics.logs.read` and added as latest-log `remote-host*` sections (no previous or stdout files), so periodic reports carry a remote
  Host's crash marker too; older Hosts without `diagnostics.logs.v1` are skipped.
- Compression is gzip only: `CompressionStream`, else the native `diagnostics_gzip_base64`; a too
  large result is composed once more at half the size before the report fails.
- Outside the desktop shell and in builds without accounts the feature is inert.

## Focused checks

- `pnpm exec vitest run src/features/diagnostics src/features/account`, `pnpm exec tsc-rs --noEmit --fast`.
- `cargo test --lib -- diagnostics` in `src-tauri/` for the native side.

## References

- User behavior: [account guide](../../../docs/guides/account.md), section Diagnostic logs.
- Owner decision: [feature-account decisions](../feature-account/references/decisions.md).
- Account client and sign-in: [feature-account](../feature-account/SKILL.md).
