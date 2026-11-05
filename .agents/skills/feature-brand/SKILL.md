---
name: feature-brand
description: Change Bycoda logo geometry, static and animated brand exports, app icons and branded voice feedback while preserving product identity and platform packaging contracts.
---

# Brand development

## Scope

Use for the application mark, wordmark lockups, favicons, startup mark, installer
art and platform launch icons. Generic activity/loading indicators belong to
their feature or Shared UI; project logos and provider icons are separate assets.
Read `public/brand/bycoda/README.md` for variant selection and regeneration.
The marketing website and nested mobile app are separate Git repositories.
An everywhere update includes their copied assets and staging inputs; parent
regeneration alone does not prove those copies or existing native resources changed.

## Source starts

- `src/shared/lib/brandGeometry.json`: canonical 80-unit rim, drop and code paths.
- `scripts/build/generate-brand.mjs`: SVG/PNG lockups, favicons, web manifest and animation.
- `scripts/build/generate-native-brand.mjs`: native icon sets, NSIS sidebar and Expo inputs.
- `scripts/build/brand-icon.mjs`: native-size optical raster rendering and ICO packing.
- `scripts/build/generate-social-brand.mjs`: existing X header's emblem, preserving surrounding pixels.
- `public/brand/bycoda/`: generated assets and usage guide.
- `src/shared/lib/productIdentity.ts`: application asset references; preserve native IDs.
- `index.html`, `src/main.tsx`: pre-React and React startup loading consumers.
- `src/features/voice/ui/VoiceVisualizer.tsx` and its CSS module: geometry-backed audio feedback.
- `src-tauri/icons/`, `src-tauri/tauri.windows.conf.json`: native packaging inputs.
- `mobile/app.json`, `mobile/assets/brand/`: separate repository's Expo icon inputs.
- `mobile/scripts/sync-brand-android.mjs`: targeted existing Android raster refresh.
- `mobile/scripts/preview-archive.mjs`: required native/runtime/splash/favicon staging inputs.

## Preserve

- Keep the six-lobed saucer rim, six independent outlined diamond droplets and
  bold filled `</>` code symbol. No connecting strokes between droplets.
- Small shell/favicon exports use the canonical `smallDrop` optical variant:
  shorter outer tips leave room for pixel-sized strokes without joining the rim.
  Render each raster at its target dimensions, not by resizing the1024px master.
  Include Windows20/40px DPI sizes and use small-metric assets for the Windows
  tray rather than shrinking the default large window icon a second time.
- Preserve optical gaps, aspect ratio and the existing custom outlined wordmark.
  Check 16/24/32/48 px before assuming large artwork works as an icon.
- Use the same geometry in exported assets and embedded voice feedback; do not
  maintain independent copies of path strings in React or native consumers.
- Keep loading state truthful. Logo updates do not change startup readiness,
  async operation state, microphone consent, audio authority or provider identity.
- Startup advances one red droplet outline at a time. Reduced motion stops the
  loop; reveal animations use their static final state. Never spin the whole logo.
- Keep fixed black/white, light/dark, transparent, adaptive and maskable exports.
  Platform launch icons retain safe zones, alpha and required dimensions.
- Generation does not authorize install, publication, release or app identity changes.
  Preserve mobile's separate Git state and concurrent voice/UI changes.
- Website copies retain their existing public URLs and locale-specific social
  layouts. Synchronize from canonical exports, not independent redraws. Preserve
  historical product screenshot provenance and distinguish it from live branding.
  Active product captures with an old visible mark need a fresh isolated native
  capture and updated manifest; never paste a new mark into screenshot evidence
  or hot-swap another session's frozen source/runtime to make it look current.

## Workflow and checks

1. Inspect Git state, recent history, live feature claims and all asset references.
2. Edit geometry once, regenerate browser assets, then native/mobile inputs.
   Synchronize website exports/social cards and verify mobile preview archives
   include runtime, splash and favicon assets. Existing ignored native resources
   need an explicit targeted refresh; do not reset/prebuild the whole project.
3. Open output images. Review all lockups on light/dark at 1280/800 px, small
   icons, loading phases, reduced motion and branded voice consumers.
4. Verify SVG loading timing and drop count with rendered computed styles, PNG
   dimensions/alpha, ICO/ICNS headers, manifest targets and mobile byte identity.
5. Run focused voice tests, normal `tsc-rs` when source changes, and
   `node scripts/checks/check-feature-skills.mjs` for this card.
6. Report source delivery separately from installed/native/device acceptance.
   Keep task inventory, captures, results and build identity in task handoff files.
