import { expect, it, vi } from "vitest";
import { readDesktopPresence } from "./desktop-presence";

it("logs why a failed desktop read counts this computer as away", async () => {
  const warn = vi.fn();
  const failed = await readDesktopPresence({
    platform: "win32",
    run: async () => {
      throw new Error("timed out");
    },
    warn,
  });
  expect(failed).toEqual({ supported: false, locked: true });
  expect(warn).toHaveBeenCalledWith(
    "Desktop presence could not be read; availability counts this computer as away.",
    "(timed out)",
  );
  const read = await readDesktopPresence({
    platform: "win32",
    run: async () => JSON.stringify({ locked: false, supported: true, idleMs: 42 }),
    warn,
  });
  expect(read).toEqual({ locked: false, supported: true, idleMs: 42 });
  expect(warn).toHaveBeenCalledTimes(1);
});
