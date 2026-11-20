import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const entry = readFileSync(new URL("./permissionHelperMain.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("./PermissionHelper.tsx", import.meta.url), "utf8");

it("boots the permission helper like the other secondary windows", () => {
  expect(entry).toContain("bootSecondaryWindowAppearance()");
  expect(entry).toContain("installNativeContextMenuGuard()");
  // The render waits for the locale; it is not called at module load.
  expect(entry).toMatch(/languageReady[\s\S]*\.then\(\(\) => createRoot\(/);
  expect(entry).not.toMatch(/^createRoot\(/m);
});

it("leaves the helper's theme to the app appearance bootstrap", () => {
  // The app marks light mode with theme-light; a component-level OS sync would override the saved theme.
  expect(helper).not.toContain("prefers-color-scheme");
  expect(helper).not.toContain("dataset.theme");
});
