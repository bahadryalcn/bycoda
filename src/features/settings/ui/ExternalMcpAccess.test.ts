// @vitest-environment jsdom
// Failed revocation must never announce success or hide the active grant.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), remote: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mock.remote }));
vi.mock("../../connections/model/localSync", () => ({ isLocalSyncMachine: () => true }));
import { ExternalMcpAccess } from "./ExternalMcpAccess";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(["rejection", "false-result"])(
  "retains a retryable failure for %s without claiming the token was revoked",
  async (failure) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const machine = {
      id: "synthetic-host",
      endpoint: "http://127.0.0.1:1",
      environmentId: "synthetic",
      name: "Fixture",
    };
    mock.invoke.mockImplementation(async (command) => {
      if (command !== "remote_machines") throw new Error("Unexpected native call: " + command);
      return [machine];
    });
    mock.remote.mockImplementation(async (_id, method) => {
      if (method === "projects.list") return [{ id: "p", name: "Fixture", cwd: "/fixture" }];
      if (method === "mcp.tokens.list")
        return {
          tokens: [
            {
              id: "g",
              name: "Synthetic grant",
              projectId: "p",
              scopes: { conversation: ["read"] },
              createdAt: 1,
              expiresAt: Date.now() + 600000,
            },
          ],
        };
      if (method === "mcp.tokens.revoke") {
        if (failure === "rejection") throw new Error("Synthetic offline rejection");
        return { revoked: false };
      }
      throw new Error("Unexpected RPC: " + method);
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ExternalMcpAccess, { cwd: "/fixture" })));
      const findButton = () =>
        [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (node) => !node.closest("[inert]") && node.textContent?.trim() === "Revoke token",
        )!;
      expect(findButton()).toBeTruthy();
      await act(async () => findButton().click());
      now += 400;
      await act(async () => findButton().click());
      expect(mock.remote.mock.calls.filter((call) => call[1] === "mcp.tokens.revoke")).toHaveLength(
        1,
      );
      expect(container.textContent).toContain("Token revocation failed. Refresh and try again.");
      expect(container.textContent).toContain("Active");
      const confirmation = container.querySelector('[data-state="done"]');
      expect(confirmation).toBeNull();
      expect(container.querySelector('[data-state="error"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      mock.remote.mockClear();
    }
  },
);
