import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Decorative loops that keep a visible pending or live state pause their clock while the window
 * is hidden or minimized (and, where the sheet already listens, while decorative motion is off).
 * The element stays on screen so the state still reads; nothing is removed or hidden. */
const PAUSED_LOOPS: Array<{ path: string; selector: RegExp }> = [
  {
    path: "src/shared/ui/arc/expanding-button-group/expanding-button-group.module.css",
    selector:
      /:global\(html:is\(\[data-decorative-motion="off"\],\s*\[data-window-visible="off"\]\)\)\s+\.item\[aria-busy="true"\]\s+\.icon\s*\{\s*animation-play-state: paused;\s*\}/,
  },
  {
    path: "src/shared/ui/arc/line-chart/line-chart.module.css",
    selector:
      /:global\(html\[data-window-visible="off"\]\) \.chart\[data-loading\] \.series,\s*:global\(html\[data-window-visible="off"\]\) \.skeleton\s*\{\s*animation-play-state: paused;\s*\}/,
  },
];

it.each(PAUSED_LOOPS)("$path pauses its loop when hidden", ({ path, selector }) => {
  const css = readFileSync(path, "utf8");
  expect(css).toMatch(selector);
  // Paused, not removed: the busy or loading state must stay visible.
  const pauseBlock = css.match(selector)?.[0] ?? "";
  expect(pauseBlock).not.toMatch(/animation:\s*none|display:\s*none|visibility:\s*hidden/);
});

it("keeps the voice launcher status visible as a static shared dot", () => {
  const voice = readFileSync("src/features/voice/ui/VoiceCompanion.module.css", "utf8");
  const launcher = readFileSync("src/features/voice/ui/companion/VoiceLauncher.tsx", "utf8");
  const dot = launcher.match(/<StatusDot\s+className=\{styles\.launcherDot\}[^>]*\/>/)?.[0];
  expect(dot).toContain("tone={tone}");
  expect(dot).toContain('appearance="solid"');
  expect(voice).not.toMatch(/\.launcherDot[^{]*\{[^}]*\banimation(?:-[\w-]+)?\s*:/);
});

it("keeps the line chart's decorative-off stop beside its hidden-window pause", () => {
  const chart = readFileSync("src/shared/ui/arc/line-chart/line-chart.module.css", "utf8");
  expect(chart).toMatch(
    /html\[data-decorative-motion="off"\]\) \.chart\[data-loading\] \.series,\s*:global\(html\[data-decorative-motion="off"\]\) \.skeleton\s*\{\s*animation: none;/,
  );
});
