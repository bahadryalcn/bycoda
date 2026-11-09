---
name: feature-terminal
description: "Change local/project/file/dedicated terminals, SSH terminal presentation, xterm colors, typography, search, selection, zoom, grid sizing or PTY lifecycle."
---

# Terminal

Own terminal reading/input presentation and existing process controllers. Servers owns saved SSH connection/tab policy; Appearance/theme foundations own shared color/type roles; Host runtime owns pipe/transport admission. Styling does not authorize a new shell or remote operation.

## Source entry points

Code paths below are repository-root relative.

- `src/features/terminal/ui/TerminalView.tsx`
- `src/features/terminal/ui/TerminalTools.tsx`
- `src/features/terminal/`
- `host/terminals/terminals.ts`, `host/terminal-process.ts`
- `src-tauri/src/mobile_pty.rs`, `src-tauri/src/pty.rs`

## Workflow

1. Identify affected local/project/file/dedicated/SSH consumers and whether the defect is renderer policy, effective canvas, saved typography, grid geometry or actual transport.
2. Use shared terminal/theme policy and existing xterm lifecycle. Change appearance through live updates and repaint, retaining PTY identity, scrollback and state.
3. Check effective background and xterm correction semantics for normal/bright/dim/inverse, indexed/truecolor, colored cells, cursor, search and selection; do not certify glyph contrast from raw palette math.
4. Exercise input/IME, copy/search, resize/visibility, zoom/reset, light/dark/custom surfaces and affected SSH/tab consumers without respawning a running shell.

## Preserve

- Coalesce streaming-output search refreshes within a bounded delay; explicit query, navigation and resize remain responsive. Cancel queued refreshes when query, terminal or search mode changes without writing PTY input.
- Keep active/pending/unknown terminal capacity separate from exited history. A stop dispatch or process error is not exit proof; failed lease release remains retriable. Replay retains original authorization, and shutdown reports unconfirmed retirement.
- Mobile PTY close acknowledges only exact-generation physical exit. Replay retirement also needs output drain, no replay gap and no unknown input. Completed attach receipts may expire independently; expired IDs remain fenced for the native runtime lifetime.

- `src-tauri/src/provider_terminal_profiles.rs` retains invalid/unreadable registry evidence and writes through the synced native state helper. Missing, corrupt and dangling-linked profile registries are distinct; failed persistence cannot claim a connection or erase CLI-home references.

- Preserve source output/copy bytes, scrollback, PTY/SSH/process identity and active work. Never recolor by rewriting escape bytes, NO_COLOR or shell prompts.
- Typography and effective canvas/contrast are separate policies; an optional line-height prop must not silently change transparency.
- Keep saved terminal font/size/weight/lineHeight, stored migration and scoped Ctrl+wheel behavior. Reset returns to saved preference without respawn.
- Preserve wide glyphs, TUI grid fitting, shell spacing restoration, flow/visibility/resize, keyboard/IME, drag/tab/split focus and native approval/history restrictions.
- Refit the retained terminal after a renderer transition: DOM and WebGL can use different cell metrics even when the host dimensions stay unchanged.
- Search and ghost suggestions are not executed output; no PTY input until explicit supported acceptance. Reduced motion disables unnecessary cursor motion.
- Unknown image/filter/opacity backdrops remain unresolved; modeled contrast and xterm minimumContrastRatio do not prove every actual glyph or selected colored cell.

## Verification and references

- Choose TerminalView/TerminalTools and changed theme/palette/contrast/PTY controller tests. Use a bounded renderer fixture for relevant ANSI/truecolor/search/selection/TUI cases.
- Review required themes/widths, custom backgrounds and reduced motion; verify native PTY/live SSH separately when their behavior changes. Math or a DOM fixture is not WebGL/native acceptance.
- Read the [surface map](references/surfaces.md) for the affected UI, state, transport and test owners. Re-search current callers before broad changes.
- [Terminal behavior](../../../docs/guides/terminal.md)
- [Host transport](../../../docs/reference/host-runtime.md)
