import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Pages stuck beneath the sticky settings page bar offset from its shared token, so a density or
// narrow-layout change to the bar cannot leave a page's rows sliding under it.
it("offsets settings sticky surfaces from the page bar token", () => {
  const stuckBelowBar = [
    "src/features/settings/ui/AppearanceSettings.css",
    "src/features/settings/ui/ProviderSettings.css",
    "src/features/settings/ui/appearance/controls/TypographySamples.css",
  ];
  for (const path of stuckBelowBar) {
    const source = readFileSync(path, "utf8");
    expect(source, path).toContain("var(--settings-page-bar-height)");
    expect(source, path).not.toMatch(/var\(--ui-control-height-compact\)\s*\+\s*\d+px/);
  }
  const providers = readFileSync("src/features/settings/ui/ProviderSettings.css", "utf8");
  expect(providers).toContain("inset-block-start: var(--settings-page-bar-height);");
  expect(providers).toMatch(/max-block-size: calc\(100vh - var\(--settings-page-bar-height\)/);
  const bar = readFileSync("src/features/settings/ui/BycodaSettings.css", "utf8");
  expect(bar).toContain(
    "padding-block: var(--settings-page-bar-padding-start) var(--settings-page-bar-padding-end);",
  );
  expect(bar).toMatch(
    /--settings-page-bar-height:[^;]+var\(--settings-page-bar-padding-start\)[^;]+var\(--settings-page-bar-padding-end\)/,
  );
  expect(bar).toMatch(
    /\.settings-page-bar,\s*\.bycoda-settings-form\s*\{\s*--settings-page-bar-padding-start: 12px;/,
  );
});
