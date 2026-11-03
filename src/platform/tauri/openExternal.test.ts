import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import { ExternalUrlError, isExternalUrl, openExternal } from "./openExternal";

describe("openExternal", () => {
  beforeEach(() => mocks.openUrl.mockReset());

  it("opens absolute http(s) and mailto URLs", async () => {
    mocks.openUrl.mockResolvedValue(undefined);
    await openExternal("https://example.com/path?q=1");
    await openExternal(new URL("mailto:someone@example.com"));
    expect(mocks.openUrl.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/path?q=1",
      "mailto:someone@example.com",
    ]);
  });

  it("refuses other schemes and relative text without calling the opener", async () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "example.com", ""]) {
      await expect(openExternal(value)).rejects.toBeInstanceOf(ExternalUrlError);
      expect(isExternalUrl(value)).toBe(false);
    }
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
