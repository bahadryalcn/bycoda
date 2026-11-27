// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { terminalColors } from "./terminalTheme";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.replaceChildren();
});

it("keeps the cursor visible when the pointer-mode focus ring is transparent", () => {
  // arc.css draws no focus ring until keyboard input; the cursor must not inherit that.
  document.documentElement.style.setProperty("--ui-focus-ring-color", "transparent");
  document.documentElement.style.setProperty("--terminal-text", "rgb(20, 30, 40)");
  const scope = document.createElement("div");
  document.body.append(scope);

  const { theme } = terminalColors(false, scope);

  expect(theme.cursor).toBe("rgb(20, 30, 40)");
  expect(theme.cursor).toBe(theme.foreground);
});
