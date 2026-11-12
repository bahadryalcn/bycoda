import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const settings = readFileSync("src/features/settings/ui/BycodaSettings.css", "utf8");
const theme = readFileSync("src/styles/index.css", "utf8");

it("limits shared row hover to single-line settings", () => {
  expect(settings).toContain(".settings-row:not([data-stacked]):hover");
  expect(settings).not.toMatch(
    /\.settings-row:hover\s*\{\s*background: var\(--ui-settings-row-hover\)/,
  );
});

it("gives embedded settings an opaque canvas and navigation ground", () => {
  expect(settings).toMatch(
    /\.bycoda-settings-workbench\[data-settings-embedded\]\s*\{[^}]*--ui-workspace-canvas: var\(--color-background-base\);[^}]*--ui-workspace-panel: var\(--color-background-base\);/,
  );
});

it("bypasses image attenuation and gradient veils without overriding scope", () => {
  expect(theme).toContain(
    "var(--chat-background-layer-opacity, var(--chat-background-empty-opacity))",
  );
  expect(theme).toContain(
    "var(--chat-background-layer-opacity, var(--chat-background-session-opacity))",
  );
  expect(theme).toMatch(
    /html\.chat-background-layer-off\s*\{[^}]*--chat-background-layer-opacity: 1;/,
  );
  expect(theme).toMatch(
    /html\.chat-background-layer-off \.gradient-blur-background\s*\{[^}]*mask-image: none;/,
  );
  expect(theme).toMatch(
    /html\.chat-background-layer-off \.gradient-blur-background::after,[^{]*\{[^}]*display: none;/,
  );
  expect(theme).toContain("opacity: 0;");
});
