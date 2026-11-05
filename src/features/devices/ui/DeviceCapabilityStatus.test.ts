// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DeviceCapabilityStatus } from "./DeviceCapabilityStatus";
import type { DeviceHostStatus } from "../types";

vi.mock("../../../shared/ui/CapabilityStatus", () => ({
  CapabilityStatus: (props: Record<string, string>) => createElement("output", props),
}));

it("keeps owner permission unknown and clears both observed axes after refresh failure", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const status: DeviceHostStatus = {
    installed: true,
    running: true,
    agentInstalled: true,
    platform: "win32",
    platforms: [{ platform: "android", available: true }],
  };
  const props = { status, checking: false, unavailable: false, viewing: true, operating: false };
  try {
    await act(async () => root.render(createElement(DeviceCapabilityStatus, props)));
    expect(container.querySelector("output")?.getAttribute("permission")).toBe("unknown");
    expect(container.querySelector("output")?.getAttribute("readiness")).toBe("ready");
    expect(container.querySelector("output")?.getAttribute("activity")).toBe("running");
    await act(async () =>
      root.render(createElement(DeviceCapabilityStatus, { ...props, unavailable: true })),
    );
    expect(container.querySelector("output")?.getAttribute("readiness")).toBe("unknown");
    expect(container.querySelector("output")?.getAttribute("activity")).toBe("unknown");
    await act(async () =>
      root.render(createElement(DeviceCapabilityStatus, { ...props, checking: true })),
    );
    expect(container.querySelector("output")?.getAttribute("readiness")).toBe("checking");
    expect(container.querySelector("output")?.getAttribute("activity")).toBe("unknown");
  } finally {
    await act(async () => root.unmount());
  }
});
