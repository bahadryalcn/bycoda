// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CapabilityStatus, type CapabilityStatusProps } from "./CapabilityStatus";

it("keeps permission, readiness and activity independent, including failed refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async (props: CapabilityStatusProps) => {
    await act(async () => root.render(createElement(CapabilityStatus, props)));
    return Object.fromEntries(
      [...container.querySelectorAll("[data-capability-axis]")].map((axis) => [
        axis.getAttribute("data-capability-axis"),
        axis.getAttribute("data-state"),
      ]),
    );
  };
  try {
    expect(await render({ permission: "enabled", readiness: "ready", activity: "idle" })).toEqual({
      permission: "enabled",
      readiness: "ready",
      activity: "idle",
    });
    expect(container.textContent).toContain("Verified ready");
    expect(
      await render({ permission: "enabled", readiness: "unknown", activity: "unknown" }),
    ).toEqual({ permission: "enabled", readiness: "unknown", activity: "unknown" });
    expect(container.textContent).not.toContain("Verified ready");
    expect(
      await render({ permission: "disabled", readiness: "ready", activity: "running" }),
    ).toEqual({ permission: "disabled", readiness: "ready", activity: "running" });
    expect(container.querySelectorAll("dt")).toHaveLength(3);
    expect(container.querySelectorAll("dd")).toHaveLength(3);
    expect(container.querySelector("button,input")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
