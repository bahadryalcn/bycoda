import { expect, it } from "vitest";
import { isLinuxWebKit } from "./transcriptGlass";

const webkit = { webkitConvertPointFromPageToNode() {} };

it("flattens the transcript glass only for WebKit on Linux", () => {
  expect(isLinuxWebKit(true, webkit)).toBe(true);
  // Chromium on Linux, and WebKit or Chromium elsewhere, keep the per-message glass.
  expect(isLinuxWebKit(true, {})).toBe(false);
  expect(isLinuxWebKit(false, webkit)).toBe(false);
  expect(isLinuxWebKit(false, {})).toBe(false);
});
