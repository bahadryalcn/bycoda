import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["Win32", true],
  ["Win64", true],
  ["Windows", true],
  ["Darwin", false],
  ["MacIntel", false],
  ["Linux x86_64", false],
  ["", false],
])("detects Windows on %s as %s", async (platform, expected) => {
  vi.resetModules();
  vi.stubGlobal("navigator", { platform });
  const { IS_WIN } = await import("./platform");
  expect(IS_WIN).toBe(expected);
});
