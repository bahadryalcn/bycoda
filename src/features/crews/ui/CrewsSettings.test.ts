// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CrewsSettings } from "./CrewsSettings";

it("reports a failed sidebar preference write and retries the intended value", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.removeItem("bycoda:crews:show-on-rail");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage full");
  });
  try {
    await act(async () => root.render(createElement(CrewsSettings)));
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => toggle.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save changes",
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    write.mockRestore();
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("bycoda:crews:show-on-rail")).toBe("false");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    write.mockRestore();
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("bycoda:crews:show-on-rail");
    vi.unstubAllGlobals();
  }
});
