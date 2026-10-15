# bycoda brand assets

The original mark abstracts a Turkish tea saucer: a six-lobed rim and six petal motifs surround a custom `</>` code seal. The saucer evokes gathering around a shared table; the central seal identifies bycoda as a coding workspace. The favicon retains the scalloped silhouette and code seal while omitting the small petals for legibility. The lowercase wordmark reads `bycoda` without a word space and is drawn as vector paths, so exports do not depend on installed fonts. Do not typeset a replacement beside the symbol.

| Use                                 | Asset                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser/application UI              | `mark.svg`, `wordmark.svg`, `logo-horizontal.svg` (system light/dark adaptation)                                                                                               |
| Light background                    | `*-light.svg` / `*-light.png`                                                                                                                                                  |
| Dark background                     | `*-dark.svg` / `*-dark.png`                                                                                                                                                    |
| Full black alternative              | `*-full-dark.svg` / `*-full-dark.png` (pure `#000000` artwork on transparent background)                                                                                       |
| Black-to-red animation              | `mark-tea-red-animated.svg`, `logo-horizontal-tea-red-animated.svg`; replayable preview at `tea-red-animation.html`                                                            |
| Red droplets, static final frame    | `mark-tea-red.*`, `logo-horizontal-tea-red.*`                                                                                                                                  |
| Optional red animation dark variant | `mark-tea-red-dark.*`, `mark-tea-red-animated-dark.svg`, `logo-horizontal-tea-red-dark.*` preserve red droplets with silver outlines                                           |
| Single-color printing               | `*-black.svg` or `*-white.svg`                                                                                                                                                 |
| Symbol only                         | `mark-*`                                                                                                                                                                       |
| Lettering only                      | `wordmark-*`                                                                                                                                                                   |
| Symbol and label                    | `logo-horizontal-*`                                                                                                                                                            |
| Vertical lockup                     | `logo-stacked-*`                                                                                                                                                               |
| Desktop application                 | `app-icon.svg` / `app-icon.png`; generated platform formats in `src-tauri/icons/`                                                                                              |
| Browser tab                         | `favicon.svg`, `favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `favicon.ico`                                                                                             |
| Apple home screen                   | `apple-touch-icon.png`                                                                                                                                                         |
| Full dark app and web icons         | `app-icon-full-dark.*`, `favicon-full-dark.svg`, `favicon-full-dark-{16,32,48}.png`, `favicon-full-dark.ico`, `apple-touch-icon-full-dark.png`, `icon-full-dark-{192,512}.png` |
| Web installation                    | `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `icon-maskable.png`                                                                                                    |

Palette: graphite `#262930`, silver `#DCE2EA`. Light/dark names refer to the intended background. Transparent PNG exports accompany the fixed-color vectors. For UI with a user-selected theme, choose the fixed-color asset matching that surface, or tint the monochrome adaptive asset with CSS. Leave at least 12 units around the 80-unit symbol; keep the symbol at least 16 px wide and the horizontal logo at least 120 px wide. Preserve aspect ratios and avoid shadows, gradients, or animation within the artwork.

The full dark filenames contain pure black (`#000000`) artwork on transparent backgrounds. No gray, silver, or filled background is included. Use on a light surface; black artwork is invisible on black surfaces. These remain alternative artwork exports, including transparent home-screen sizes for compositing.

The application uses monochrome artwork with the smaller central code seal: black in light mode and white in dark mode. Desktop app, web installation, and favicon exports use white artwork on black. Red droplets are reserved for the startup animation and optional animation previews.

The tea-red animation starts with pure black droplets, then changes the six droplets clockwise to tea red `#D32030`. Each transition lasts 0.85 seconds, begins after a 0.5-second hold, and is offset by 0.12 seconds. All droplets reach red at 1.95 seconds and hold. The saucer outline, code seal, and wordmark remain black; backgrounds stay transparent. Reduced-motion preference shows the final red state without animation. The SVGs animate natively in browsers, including when used as image sources; no runtime library is required.

Regenerate SVG/PNG exports with `node scripts/build/generate-brand.mjs` (requires the project's Playwright Chromium). Regenerate desktop formats with `pnpm exec tauri icon public/brand/bycoda/app-icon.png --output src-tauri/icons`. The ICO favicon uses the 16/32/48 PNG exports.
