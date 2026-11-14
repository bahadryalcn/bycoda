// @vitest-environment jsdom
// Sign-in rows show Host state only, open the Host-issued URL externally and surface failures.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), remote: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mock.remote }));
vi.mock("../../connections/model/localSync", () => ({ isLocalSyncMachine: () => true }));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mock.open }));
import { McpOAuthSignIn } from "./McpOAuthSignIn";

afterEach(() => {
  mock.remote.mockReset();
  mock.invoke.mockReset();
  mock.open.mockReset();
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(McpOAuthSignIn, { cwd: "/fixture" })));
  return { container, unmount: () => act(async () => root.unmount()) };
}
const buttons = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent);
const click = (container: HTMLElement, label: string) =>
  act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === label)!
      .click(),
  );

it("renders nothing without http servers", async () => {
  mock.invoke.mockResolvedValue([{ id: "local" }]);
  mock.remote.mockResolvedValue({ servers: [] });
  const { container, unmount } = await mount();
  expect(container.textContent).toBe("");
  await unmount();
});

it("shows per-server state with Sign in or Sign out and opens the Host URL externally", async () => {
  mock.invoke.mockResolvedValue([{ id: "local" }]);
  let states = [
    { name: "alpha", state: "none" },
    { name: "beta", state: "signed-in" },
  ];
  mock.remote.mockImplementation(async (_id: string, method: string, params: any) => {
    if (method === "mcp.oauth.status") return { servers: states };
    if (method === "mcp.oauth.start") {
      expect(params).toEqual({ name: "alpha", cwd: "/fixture" });
      return { authorizationUrl: "https://auth.example/authorize?x=1" };
    }
    states = [states[0], { name: "beta", state: "none" }];
    return { signedOut: true };
  });
  const { container, unmount } = await mount();
  expect(container.textContent).toContain("Not signed in");
  expect(container.textContent).toContain("Signed in");
  expect(buttons(container)).toContain("Sign in");
  expect(buttons(container)).toContain("Sign out");
  await click(container, "Sign in");
  expect(mock.open).toHaveBeenCalledWith("https://auth.example/authorize?x=1");
  expect(container.textContent).toContain("Finish signing in in your browser");
  await click(container, "Sign out");
  expect(container.querySelector('[data-server="beta"]')?.textContent).toContain("Not signed in");
  await unmount();
});

it("reports a failed start without exposing the cause", async () => {
  mock.invoke.mockResolvedValue([{ id: "local" }]);
  mock.remote.mockImplementation(async (_id: string, method: string) => {
    if (method === "mcp.oauth.status") return { servers: [{ name: "alpha", state: "error" }] };
    throw new Error("token=secret");
  });
  const { container, unmount } = await mount();
  expect(container.textContent).toContain("Sign-in failed");
  await click(container, "Sign in");
  expect(container.textContent).toContain("Sign-in could not be started");
  expect(container.textContent).not.toContain("secret");
  expect(mock.open).not.toHaveBeenCalled();
  await unmount();
});
