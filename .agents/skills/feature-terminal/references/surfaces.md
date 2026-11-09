# Terminal surface map

Paths are repository-root relative. Inspect all callers of TerminalView when shared rendering/lifecycle changes.

- `src/features/terminal/ui/TerminalView.tsx`, `TerminalTools.tsx` and terminal styles/models: xterm construction, addons, input/search/selection, effective theme and saved typography. Adjacent `TerminalView.test.ts` and `TerminalTools.test.ts` are focused consumer entry points.
- Project terminal docks, file panes, dedicated terminals and Servers/SSH tab surfaces compose the shared renderer. Search `ProjectTerminalDock`, `TerminalView`, local/dedicated terminal and SSH callers through `src/app/` and `src/features/` before changing optional props or geometry.
- Shared palettes/theme policy belong under `src/styles/` and `src/features/terminal/runtime/terminalTheme.ts`. Follow the actual canvas/contrast owner rather than introducing local color recipes. Appearance settings/preview owns saved terminal typography and sample content.
- Native PTY, shell and SSH bridges remain under `src/platform/`, `src-tauri/src/` and their existing Host/domain adapters; follow current IPC and resource owners for transport changes. Host pipe-shell HTTP/WS is distinct from native PTY/SSH leases.
- Saved shell-profile/settings consumers use existing preference owners; retain drafts, validation, persistent profile identity and explicit terminal restart consequences.
- Browser terminal/readability fixtures under `tests/browser/` can exercise ANSI/truecolor, selection/search/cursor, zoom/reset and resize. Choose actual DOM/WebGL fallback and retained shell tests appropriate to the change.
- Locale sentence families include terminal/search/current-result/zoom/reset/profile and recoverable connection/action errors. Keep selection/copy bytes independent of translated chrome.

The user contract is `docs/guides/terminal.md`. Cross-feature authority stays in `docs/reference/host-runtime.md`; generic theme changes require the theme/shared-UI skills, and saved SSH lifecycle changes require feature-servers.
