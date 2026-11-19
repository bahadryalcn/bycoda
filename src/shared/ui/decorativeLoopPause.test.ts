import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Decorative loops that keep a visible pending or live state pause their clock while the window
 * is behind another app (and, where the sheet already listens, while decorative motion is off).
 * The element stays on screen so the state still reads; nothing is removed or hidden. */
const PAUSED_LOOPS: Array<{ path: string; selector: RegExp }> = [
  {
    path: "src/features/voice/ui/VoiceCompanion.module.css",
    selector:
      /:global\(html:is\(\[data-decorative-motion="off"\], \[data-window-focus="off"\]\)\) \.launcherAvatar \.launcherDot\s*\{\s*animation-play-state: paused;\s*\}/,
  },
  {
    path: "src/shared/ui/arc/expanding-button-group/expanding-button-group.module.css",
    selector:
      /:global\(html:is\(\[data-decorative-motion="off"\], \[data-window-focus="off"\]\)\) \.item\[aria-busy="true"\] \.icon\s*\{\s*animation-play-state: paused;\s*\}/,
  },
  {
    path: "src/shared/ui/arc/line-chart/line-chart.module.css",
    selector:
      /:global\(html\[data-window-focus="off"\]\) \.chart\[data-loading\] \.series,\s*:global\(html\[data-window-focus="off"\]\) \.skeleton\s*\{\s*animation-play-state: paused;\s*\}/,
  },
];

it.each(PAUSED_LOOPS)("$path pauses its decorative loop for window blur", ({ path, selector }) => {
  const css = readFileSync(path, "utf8");
  expect(css).toMatch(selector);
  // Paused, not removed: the busy or loading state must stay visible.
  const pauseBlock = css.match(selector)?.[0] ?? "";
  expect(pauseBlock).not.toMatch(/animation:\s*none|display:\s*none|visibility:\s*hidden/);
});

it("keeps the reduced-motion and decorative-off stops that the pause rules sit beside", () => {
  const voice = readFileSync("src/features/voice/ui/VoiceCompanion.module.css", "utf8");
  expect(voice).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.launcherAvatar \.launcherDot\s*\{\s*animation: none;/,
  );

  const chart = readFileSync("src/shared/ui/arc/line-chart/line-chart.module.css", "utf8");
  expect(chart).toMatch(
    /html\[data-decorative-motion="off"\]\) \.chart\[data-loading\] \.series,\s*:global\(html\[data-decorative-motion="off"\]\) \.skeleton\s*\{\s*animation: none;/,
  );
});
