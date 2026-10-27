---
name: feature-terminal
description: Terminal inventory for local/project/file/dedicated terminals, SSH, xterm light/dark ANSI and truecolor readability, effective canvas, cursor/selection/search, font/zoom, grid fitting, TUI, completion, PTY ownership and mobile counterparts. Read before terminal design or behavior changes.
---

# Terminal

## Purpose and source scope

Readable local/SSH output and predictable input, without changing shell meaning
or interrupting active work. Keywords: terminal, xterm, ANSI, light/dark, contrast,
font, line height, zoom, cursor, selection, search, split, TUI, PTY, SSH.

Inspected 2026-10-27: dirty shared `main @
0a42b1ab4fd891ccec5ca0fa238d7356b396b13c`. Recent history:
`29d534f9`, `07a34eff`, `3419af02`, `0a6973a2`. Roots: terminal UI/model,
explicit files/connections/app consumers, settings/theme owners, installed xterm
source, native/Host transport, browser fixtures and mobile terminal routes.
Two native reviews and parent checks covered one supplied light screenshot;
dark rendering and installed-build inclusion remain unverified/UNKNOWN.

## Surface inventory

| Surface family                 | Owners                                                                                                                                                                                                                                           | Current evidence                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Project dock/splits            | `src/features/terminal/ui/ProjectTerminalDock.tsx`, `terminal.css`; `src/features/projects/model/projectTerminal.ts`; `src/features/workspace/model/workspaceSnapshot.ts`                                                                        | Source audit; no new rendered acceptance.                         |
| File/dedicated terminals       | `src/features/files/ui/FilePane.tsx`; `src/app/workspace/layout/WorkspaceToolPanels.tsx`; `src/features/terminal/ui/TerminalView.tsx`                                                                                                            | Shared source audit; owner image shows dedicated terminal.        |
| SSH saved/quick/private        | `src/features/connections/ui/ServersTerminalWorkspace.tsx`, `ServerTerminalSession.tsx`, `ServerTerminalSession.module.css`; TerminalView                                                                                                        | Wrapper/source audit; private/key-generation lifecycle preserved. |
| Color/canvas/extended output   | TerminalView; `src/shared/theme/palette.ts`, `src/styles/palette.css`, `src/styles/index.css`; `src/features/terminal/model/terminalChrome.ts`                                                                                                   | Source audit + flat default nominal math.                         |
| Cursor/selection/search colors | TerminalView; `src/features/terminal/ui/TerminalTools.tsx`, `TerminalSelectionMenu.tsx`, `TerminalCursorPopover.tsx`                                                                                                                             | Source audit; actual pixel/renderer cases pending.                |
| Typography/settings            | `src/features/settings/model/appearancePreferences.ts`, `appearance.ts`; `src/features/settings/ui/AppearancePreviews.tsx`, `AppearancePreviews.css`                                                                                             | Source audit; no terminal-specific preview yet.                   |
| Scoped zoom                    | TerminalView; ServerTerminalSession                                                                                                                                                                                                              | Source audit; maintain existing settings and instance state.      |
| Fit/grid/alternate-screen      | `src/features/terminal/model/terminalLayout.ts`; TerminalView; index.css; SSH wrapper                                                                                                                                                            | Source audit; padded-host edge-marker risk needs reproduction.    |
| Tools/find/menus               | TerminalTools; `src/features/terminal/ui/TerminalTools.module.css`; `src/features/terminal/model/terminalKeys.ts`, `terminalInput.ts`                                                                                                            | Source audit; positive-match feedback proposal.                   |
| Ghost/completion/links         | `src/features/terminal/ui/TerminalGhostText.tsx`, `LocalTerminalSuggestions.tsx`, `RemoteShellSuggestions.tsx`; `src/features/terminal/model/localTerminalCompletion.ts`, `terminalSuggestions.ts`, `terminalLinks.ts`, `sshShellIntegration.ts` | Source audit/inventory; preserve output/input/privacy boundaries. |
| Native PTY/restore             | `src/platform/tauri/pty.ts`; `src-tauri/src/pty.rs`, `ssh_terminal.rs`, `terminal_profiles.rs`, `terminal_completion.rs`, `server_terminal_restore.rs`; `src/features/terminal/model/outputBuffer.ts`, `terminalTab.ts`, `terminalProfiles.ts`   | Routing/state inventory.                                          |
| Host/mobile transport          | `host/terminals.ts`, `host/terminal-process.ts`, `host/runtime-terminal-logs.ts`; `src-tauri/src/mobile_pty.rs`; `src/features/terminal/model/mobilePtyControl.ts`                                                                               | Routing inventory, no live operation.                             |
| Native mobile terminal         | `mobile/src/features/tools/terminal-screen.tsx`, `terminal-model.ts`, `mobile-pty.tsx`, `mobile-pty-model.ts`, `use-terminal-output.ts`, `pty-read-scheduler.ts`                                                                                 | Route/model inventory; separate native renderer/acceptance.       |

Native commands include `pty_spawn`, `pty_write`, `pty_resize`, `pty_set_visible`,
`pty_output_flow`, `pty_output_ack`, `pty_status`, `pty_suggestions`, `pty_kill`.
Host RPCs include `terminals.list/create/read/write/interrupt/close` under the
existing `terminals.v1` capability. Native SSH and mobile access keep their own
approval/configuration/ownership contracts; do not infer equivalence from names.

## Owner decision

2026-10-27, current conversation `0567326f-aade-4baa-89f3-b44c6256ae9e`:
"terminallerin light dark mod gösterimleri okunabilirlikleri vs tekrar elden geçmesi gerekiyor bunlarıda audit kapsamında düzenliyleim".

This extends the audit/repair plan. No larger font default, always-dark terminal,
independent palette, new shortcut or shell-profile edit was selected.

## Critical source finding and preservation

TerminalView currently selects minimumContrastRatio 1/4.5 and transparent/opaque
canvas by optional lineHeight prop presence. Project dock, FilePane and dedicated
tool omit it; SSH passes it. Actual typography still comes from preferences.
Separate rendering/contrast policy from typography and resolve effective shared
canvas before contrast correction. Preserve transparency intentionally rather
than silently changing it with a line-height prop.

Raw default palette math is not actual glyph contrast. Installed xterm adjusts
foreground RGB, has dim/background-glyph exceptions and separate extended/RGB
paths; transparent background alpha is not real-surface compositing in its
contrast math. Never claim option 4.5 certifies every glyph or overall accessibility.
Test normal/bright/bold/dim/inverse, colored backgrounds, truecolor/indexed output,
selection/search/cursor, OSC and custom surfaces. Keep ANSI background semantics.

Preserve source output, copy bytes, scrollback, shell/PTY/SSH identity and active
processes. No recoloring through byte rewriting, NO_COLOR or shell-prompt changes.
Use shared semantic themes and existing palette generation owners; no local color
recipes or separate black/gray theme. Current theme changes already update open
terminals, coalesce repaint and defer hidden terminals; preserve that behavior.

Keep terminalFont/Size/Weight/LineHeight preferences, stored codeSize migration,
per-terminal Ctrl+wheel 8–40 and live no-respawn updates. Default is 13px/400/1;
scaled screenshot cannot establish the actual stored value. Keep TUI grid stretch
and shell spacing restoration, resize/flow/visibility, IME, wide glyphs, keyboard,
tab/split movement, native approvals and private-terminal history restrictions.
Ghost suggestions are not executed output and must not enter the PTY until
explicit supported acceptance. Search must never become shell input.

## Checks and scenarios

Existing focused owners: TerminalView/TerminalTools/TerminalGhostText,
TerminalSelectionMenu/TerminalCursorPopover, terminalLayout/terminalChrome/
terminalKeys/terminalInput/terminalTab/outputBuffer, ProjectTerminalDock/
projectTerminal/workspaceSnapshot, appearancePreferences and relevant SSH/native
tests. Browser entrypoints: `tests/browser/terminal-tools.tsx`,
`terminal-tools.html`, `terminal-tools-pty.ts`, `terminal-tools.e2e.ts`,
`terminal-settings.e2e.ts`, `playwright.terminal-tools.config.ts`.
Source checks use tsc-rs. Existing typography fixture uses saved 16px/600/1.35,
not default-font or real contrast proof; mocks of colors do not measure rendering.

Actual changed surfaces require light/dark at 1280/800 and narrow splits/SSH,
default and saved fonts/sizes, physical DPI/scale, WebGL/fallback, custom
backgrounds, controlled ANSI/RGB corpus, exact copy/output, current/hidden theme
switches, cursor/selection/find/ghost, reduced motion, shell/TUI edge markers and
no PTY replacement. Use fake PTY output; do not start/stop real work for screenshots.
Native mobile, real SSH and installed display acceptance remain separately named.

## Proposals and delivered evidence

Local register: `temp/local/2026-10-27-terminal-readability/AUDIT.md` (11 records:
two visual/source, nine source-only; 13 coverage families). Repair direction:
adjacent `REPAIR.md`. Nominal computation: `contrast-math.mjs`; output/evidence:
`temp/verification/2026-10-27-terminal-readability/`.

Agent proposals: shared effective-canvas/normal-text contrast policy, readable
cursor/selection/search, explicit zoom readback/reset, non-executing terminal
settings preview, reduced-motion cursor and content-box fitting where reproduced.
No new font/spacing default or blanket ANSI inversion is approved by the audit.

Audit/math/card/plan delivered locally and uncommitted at the baseline above.
Product source, preferences, shell profiles, PTYs, build/install/release untouched.
Capture inclusion UNKNOWN. Live claim API is unavailable; Git/session state was
checked without claiming a cross-machine reservation. Preserve concurrent
sidebar/updater/ButtonGroup/Host edits. Update user guides when behavior changes.

## Settings shell-profile extension, 2026-10-27

Owner, conversation0567326f-aade-4baa-89f3-b44c6256ae9e, two Settings captures:

> terminal ayarlarıda bu şekilde en toparlısı burası ama buranında düzenlenmesi gerekiyor.

This requests refinement/audit, not new shell/font/palette/timeout/SSH defaults.
Prior output-readability11 findings remain separate; do not recount them.
New register/brief: `temp/local/2026-10-27-settings-terminal-audit/`,12 records
(two V+S/ten S),14 connected families. Two native read-only reviews plus root.
Baseline shared main d8bf868fae841b8b391ce148487cd7d373ea9762;16 root sources
unchanged from HEAD, remote.rs/mobile shell settings concurrent snapshot-only.
Capture inclusion unknown. Live claims unavailable; available state inspected,
no exclusive reservation. Preserve concurrent source/Host/mobile/index work.

Settings owners: `src/features/settings/ui/TerminalSettings.tsx`/.css and
settingsControls.tsx; `src/features/terminal/model/terminalProfiles.ts`,
`src/features/connections/model/localSync.ts`, connections.ts/remoteRequest,
`src-tauri/src/terminal_profiles.rs`, `host/shellProfiles.ts`. Search catalog
in settings/model/settings.ts and SettingsView navigation. Shell discovery here
differs from provider-account TerminalProfileDiscovery owned by Providers.

Top local and Local sync controls use the same machine terminal-profile.json
but independent UI/cache state; not two independent defaults. Native commands
terminal_profiles/set_terminal_profile and Host shell.profiles/shell.setProfile/
shell.setProfileReviewed preserve installed choice/Automatic fallback and authority.
New local PTYs use TerminalView/pty.ts; !commands route through useSessionShell,
fs/harness or Host shell.ts. Existing open PTYs/commands keep their shell/process.
Windows Automatic uses pwsh/powershell/cmd order, otherwise login shell/fallback.
No shell/profile write, discovery API or command was run by this audit.

Propose one local authoritative choice with Local sync applicability, compact
remote rows/nearby refresh, bounded form and consolidated help. Preserve full
paths/search, optional available-shell details and meaningful advanced disclosure.
Repair mirror-write success split, model discovery epochs, failed-file-read truth,
native detection freshness, inventory loading/error versus empty, per-machine
identity refresh and uncertain-save read-back. Make fallback visible and fix
advanced search target wiring. Preserve existing component/remoteRequest generation
guards, duplicate locks, native-save failure retention, runtime fallback and
profile validation. No automatic replay of uncertain writes.

Mobile `mobile/src/features/settings/shell-profile-settings.tsx` exists in dirty
nested checkout: snapshot-only, machine-bound shell.profile.compare.v1 and
shell.setProfileReviewed/expectedChosenId with uncertain resubmission protection.
Do not replace it with desktop unreviewed mutation. Preserve Host reviewed guard.
Browser fixture settings.tsx currently stores local/sync choices separately and
terminal-settings.e2e.ts expects divergence; correct that production-parity gap
before using it as synchronization acceptance. Existing browser matrix is
390/768/1024/1440 light/dark/reduced motion, not new1280/800 evidence.

Seven existing tests/two suites pass: terminalProfiles.test.ts and localSync.test.ts.
Three-file static scan[]. Host shellProfiles tests include actual shell execution;
not run here. New repair tests, actual changed app light/dark1280/800/narrow/zoom/
reader/keyboard, isolated native/Host/mobile and installed checks remain pending.
Diagram light728/dark390 is schematic only. Evidence under
`temp/verification/2026-10-27-settings-terminal-audit/`. Audit/design ready; no
product/profile/PTY/command/Host/index/branch/build/install/release/commit change.
Update user guides when behavior is delivered, not for this proposal alone.

## Host/WS source integration (2026-10-27)

Six Host pipe-shell RPCs now share host/domains/terminals/service.ts and neutral terminals.ts DTOs across HTTP/WS. Existing process ownership, per-device creation receipts, UTF8 bounds and workspace activity remain authoritative. PTY/SSH/control-lease migration and installed acceptance remain separate.

Source only, uncommitted; no build/install/release stamp. Current full checklist and overlapping evidence: feature-host-runtime/SKILL.md and the local IMPLEMENTATION ledger.
