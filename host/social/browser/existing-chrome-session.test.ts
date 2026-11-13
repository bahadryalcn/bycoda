import { expect, it, vi } from "vitest";
import type { Cdp } from "../social-browser";
import { attachExistingChrome } from "./existing-chrome-session";

it("creates and closes only an owned tab in the selected browser context", async () => {
  const send = vi.fn(async (method: string) => {
    if (method === "Target.getTargets")
      return {
        targetInfos: [
          {
            targetId: "selected",
            type: "page",
            url: "https://x.com/home",
            browserContextId: "profile",
          },
        ],
      };
    if (method === "Target.createTarget") return { targetId: "owned" };
    if (method === "Target.attachToTarget") return { sessionId: "session" };
    return {};
  });
  const close = vi.fn();
  const cdp = { send, close, on: vi.fn(), closed: new Promise<void>(() => {}) } as unknown as Cdp;
  const session = await attachExistingChrome(cdp, "selected", ["x.com"]);
  expect(send).toHaveBeenCalledWith("Target.createTarget", {
    url: "about:blank",
    browserContextId: "profile",
    background: true,
  });
  await session.close();
  expect(send).toHaveBeenCalledWith("Target.closeTarget", { targetId: "owned" });
  expect(send.mock.calls.some(([method]) => method === "Browser.close")).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});

it("refuses a selected page outside the allowed platform", async () => {
  const send = vi.fn(async () => ({
    targetInfos: [{ targetId: "selected", type: "page", url: "https://example.com" }],
  }));
  await expect(
    attachExistingChrome({ send } as unknown as Cdp, "selected", ["x.com"]),
  ).rejects.toThrow("not a supported platform");
  expect(send).toHaveBeenCalledTimes(1);
});
