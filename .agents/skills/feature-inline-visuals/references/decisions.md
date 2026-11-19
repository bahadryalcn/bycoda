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

## One preview across inline, panel and full view

2026-11-19, owner task #1006: "Maintain a single live sandboxed iframe/preview token across
inline/panel/full transitions using existing stable container mechanisms" (translated).

- The card mounts one HtmlPreview into a host element it creates once. Views only provide a
  slot (card, shared Sheet body, shared Modal body); the host moves between them and the
  card slot keeps the snapshot height in every view. Every view change leaves the card slot
  first, so closing a panel or dialog never removes the frame with it.
- The move uses `moveBefore`, which keeps an iframe's document and focus. Without it (or when
  it refuses) `appendChild` reparents the host, which reloads the frame's document from the
  same live token: still one token, no create/close churn, no new authority, but page state
  resets on that transition. Chromium-based WebViews support `moveBefore`; check the other
  platform WebViews natively before claiming state survives there.
- CSS-only retention (a fixed-position frame under the Sheet or Modal) was rejected: the
  overlays are body portals with their own stacking, so the frame cannot sit above their glass.
