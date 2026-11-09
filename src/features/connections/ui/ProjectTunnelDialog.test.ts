// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ featureHost: vi.fn() }));
vi.mock("../model/hostFeatureClient", () => ({ featureHost: mock.featureHost }));
vi.mock("./ExternalTunnelsPanel", () => ({
  TunnelControls: () => createElement("p", null, "Tunnel controls"),
}));
import { ProjectTunnelDialog } from "./ProjectTunnelDialog";
it("preserves retry focus and context while a deferred tunnel access check fails, then recovers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let reject!: (reason: Error) => void;
  mock.featureHost
    .mockRejectedValueOnce(new Error("Offline"))
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce({ machine: { id: "fixture" } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(ProjectTunnelDialog, {
          cwd: "/fixture",
          localUrl: "http://localhost:1234",
          onClose: vi.fn(),
        }),
      ),
    );
    const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Check again",
    )!;
    button.focus();
    await act(async () => {
      button.click();
      button.click();
    });
    expect(mock.featureHost).toHaveBeenCalledTimes(2);
    expect(button.isConnected).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => reject(new Error("Still offline")));
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    await act(async () => button.click());
    expect(document.body.textContent).toContain("Tunnel controls");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
