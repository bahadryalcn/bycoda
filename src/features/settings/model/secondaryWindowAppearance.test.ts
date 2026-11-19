import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses the same appearance bootstrap in every secondary-window entry", () => {
  const entries = [
    "../../host-tools/desktopControlWindowMain.tsx",
    "../../permissions/ui/permissionHelperMain.tsx",
    "../../quick-composer/main.tsx",
    "../../voice/voiceOverlayMain.tsx",
  ];

  for (const path of entries) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source, path).toContain("bootSecondaryWindowAppearance()");
    expect(source, path).not.toMatch(
      /SCHEME_CHANGE_EVENT|subscribeThemeStorage|watchSystemColorScheme/,
    );
  }
});
