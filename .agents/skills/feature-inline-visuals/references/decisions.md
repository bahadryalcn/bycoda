# Inline visual decisions

## Stored references instead of embedded snapshots

2026-11-07, owner: "let's do it like the reference app" (translated) (match the reference app's inline HTML visuals).

- `visuals.render` accepts full pages (512,000 characters, height 80–2000) and stores
  them content-addressed in the Host data folder. The tool result is a version 2
  reference, so provider output limits never cut a page and the model never reads
  the page back.
- The desktop resolves references from the local Host folder by id. Visuals from a
  remote Host show a retryable unavailable message until a remote read path exists.
- Pages receive app theme variables named like the reference app's (`--background`,
  `--chart-1`…) so agents can write one page that fits both themes.
- 2026-11-07, owner: "users should not have to bother with installing; all of these need to come built in"
  and "however the reference app does it, let's do it that way" (both translated). Like the reference app, the Host
  package ships npm beside its Node runtime, and the browser runtime (Playwright,
  Chromium headless shell, ffmpeg) and device tools install themselves in the
  background on first use. Chromium is downloaded, not bundled; `visuals.preview`
  answers `installing: true` meanwhile.
