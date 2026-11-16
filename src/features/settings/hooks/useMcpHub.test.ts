// @vitest-environment jsdom
// The hub hook writes only owner-confirmed policy, refetches after a failed save, locks on a corrupt
// policy and drives the Host-held sign-in without exposing the failure cause.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), remote: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: mock.remote }));
vi.mock("../../connections/public/localSync", () => ({ isLocalSyncMachine: () => true }));
vi.mock("../../../platform/tauri/openExternal", () => ({ openExternal: mock.open }));
import { clearMcpSettingsCache } from "../model/mcpSettingsCache";
import { useMcpHub, type McpHub } from "./useMcpHub";

let hub: McpHub;
function Harness({ cwd, globalOnly = false }: { cwd: string; globalOnly?: boolean }) {
  hub = useMcpHub(cwd, globalOnly);
  return null;
}

const containers: HTMLElement[] = [];
async function mount(cwd = "/fixture", globalOnly = false) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Harness, { cwd, globalOnly })));
  return { unmount: () => act(async () => root.unmount()) };
}

const policy = (direct: string[], mode = "onDemand") => ({ version: 1, mode, direct });
const gets = (method: string) => mock.remote.mock.calls.filter((c) => c[1] === method);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mock.invoke.mockResolvedValue([{ id: "local" }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mock.remote.mockReset();
  mock.invoke.mockReset();
  mock.open.mockReset();
  clearMcpSettingsCache();
  for (const container of containers.splice(0)) container.remove();
});

it("persists direct[] and refetches after a failed save", async () => {
  let stored = policy([]);
  let fail = false;
  mock.remote.mockImplementation(async (_id: string, method: string, params: any) => {
    if (method === "mcp.hub.loading.get")
      return { policy: stored, corrupt: false, servers: ["alpha", "beta"] };
    if (method === "mcp.oauth.status") return { servers: [] };
    if (fail) throw new Error("offline");
    stored = { ...stored, mode: params.mode, direct: params.direct };
    return { policy: stored, corrupt: false };
  });
  const { unmount } = await mount();
  expect(hub.loading?.policy.direct).toEqual([]);
  await act(async () => hub.setDirect("beta", true));
  expect(mock.remote).toHaveBeenCalledWith("local", "mcp.hub.loading.set", {
    mode: "onDemand",
    direct: ["beta"],
  });
  expect(hub.loading?.policy.direct).toEqual(["beta"]);
  await act(async () => hub.setMode("always"));
  expect(mock.remote).toHaveBeenCalledWith("local", "mcp.hub.loading.set", {
    mode: "always",
    direct: ["beta"],
  });
  expect(hub.loading?.policy.mode).toBe("always");

  fail = true;
  const before = gets("mcp.hub.loading.get").length;
  await act(async () => hub.setDirect("alpha", true));
  expect(gets("mcp.hub.loading.get")).toHaveLength(before + 1);
  // The successful refetch must not wipe the save failure.
  expect(hub.error).toContain("Saving MCP loading failed");
  expect(hub.loading?.policy.direct).toEqual(["beta"]);
  await unmount();
});

it("locks writes and keeps the stored file untouched when the policy is corrupt", async () => {
  mock.remote.mockImplementation(async (_id: string, method: string) =>
    method === "mcp.oauth.status"
      ? { servers: [] }
      : { policy: policy([]), corrupt: true, servers: ["alpha"] },
  );
  const { unmount } = await mount("/corrupt");
  expect(hub.loading?.corrupt).toBe(true);
  await act(async () => hub.setDirect("alpha", true));
  await act(async () => hub.setMode("always"));
  expect(gets("mcp.hub.loading.set")).toHaveLength(0);
  await unmount();
});

it("reads without a project in the global view", async () => {
  mock.remote.mockImplementation(async (_id: string, method: string) =>
    method === "mcp.oauth.status"
      ? { servers: [] }
      : { policy: policy([]), corrupt: false, servers: [] },
  );
  const { unmount } = await mount("/fixture", true);
  expect(mock.remote).toHaveBeenCalledWith("local", "mcp.hub.loading.get", {});
  expect(mock.remote).toHaveBeenCalledWith("local", "mcp.oauth.status", {});
  await unmount();
});

it("opens the Host URL externally, polls until the state changes, then signs out", async () => {
  let states = [
    { name: "alpha", state: "none" },
    { name: "beta", state: "signed-in" },
  ];
  mock.remote.mockImplementation(async (_id: string, method: string, params: any) => {
    if (method === "mcp.hub.loading.get")
      return { policy: policy([]), corrupt: false, servers: [] };
    if (method === "mcp.oauth.status") return { servers: states };
    if (method === "mcp.oauth.start") {
      expect(params).toEqual({ name: "alpha", cwd: "/fixture" });
      return { authorizationUrl: "https://auth.example/authorize?x=1" };
    }
    states = [states[0], { name: "beta", state: "none" }];
    return { signedOut: true };
  });
  const { unmount } = await mount();
  vi.useFakeTimers();
  await act(async () => hub.signIn("alpha"));
  expect(mock.open).toHaveBeenCalledWith("https://auth.example/authorize?x=1");
  expect(hub.waiting).toBe("alpha");
  // The browser redirect finishes on the Host; the next poll sees the new state and stops waiting.
  states = [{ name: "alpha", state: "signed-in" }, states[1]];
  await act(async () => vi.advanceTimersByTimeAsync(2_100));
  expect(hub.waiting).toBe("");
  expect(hub.oauth?.find((s) => s.name === "alpha")?.state).toBe("signed-in");

  await act(async () => hub.signOut("beta"));
  expect(mock.remote).toHaveBeenCalledWith("local", "mcp.oauth.signOut", {
    name: "beta",
    cwd: "/fixture",
  });
  expect(hub.oauth?.find((s) => s.name === "beta")?.state).toBe("none");
  await unmount();
});

it("reports a failed start without exposing the cause", async () => {
  mock.remote.mockImplementation(async (_id: string, method: string) => {
    if (method === "mcp.hub.loading.get")
      return { policy: policy([]), corrupt: false, servers: [] };
    if (method === "mcp.oauth.status") return { servers: [{ name: "alpha", state: "error" }] };
    throw new Error("token=secret");
  });
  const { unmount } = await mount();
  await act(async () => hub.signIn("alpha"));
  expect(hub.error).toContain("Sign-in could not be started");
  expect(hub.error).not.toContain("secret");
  expect(hub.waiting).toBe("");
  expect(mock.open).not.toHaveBeenCalled();
  await unmount();
});
