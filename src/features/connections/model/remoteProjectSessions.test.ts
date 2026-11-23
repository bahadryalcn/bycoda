// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  adoptRemoteMachineInventory,
  recordRemoteCapabilities,
  remoteRequest,
  useRemoteProjectSessions,
} from "./connections";
import type { RemoteDataState } from "./remoteDataState";
import { rememberRemoteProject } from "./remoteProjects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));

it("waits for one authenticated discovery before listing separate projects on a cold SSH machine", async () => {
  const machine = {
    id: "cold-ssh",
    name: "Mac",
    environmentId: "cold-env",
    endpoint: "",
    ssh: { target: "owner@mac", remotePort: 7000 },
  };
  adoptRemoteMachineInventory([machine]);
  const discovery = Promise.withResolvers<{ capabilities: string[] }>();
  const methods: string[] = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "remote_request") return;
    const { method } = args as { method: string };
    methods.push(method);
    return method === "environment.describe" ? discovery.promise : [];
  });
  const reads = ["a", "b", "c"].map((projectId) =>
    remoteRequest(machine.id, "sessions.list", { projectId }),
  );
  reads.push(remoteRequest(machine.id, "projects.list"));
  try {
    await vi.waitFor(() => expect(methods).toEqual(["environment.describe"]));
  } finally {
    discovery.resolve({ capabilities: [] });
    await Promise.all(reads);
    adoptRemoteMachineInventory([]);
  }
  expect(methods).toEqual([
    "environment.describe",
    "sessions.list",
    "sessions.list",
    "sessions.list",
    "projects.list",
  ]);
});

it("never renders the previous project's session cards under the new project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const portal = rememberRemoteProject("env", {
    id: "portal",
    cwd: "G:/web-portal",
    name: "portal",
  });
  const db = rememberRemoteProject("env", { id: "db", cwd: "G:/db-ai-assistant", name: "db" });
  for (const project of [portal, db]) {
    localStorage.setItem(
      `bycoda.remote-history.v2:${project.key}`,
      JSON.stringify([{ id: `${project.projectId}-session` }]),
    );
  }
  const frames: { project: string; ids: string[] }[] = [];
  function View({ project }: { project: string }) {
    const result = useRemoteProjectSessions(project);
    frames.push({ project, ids: result.sessions.map((session) => session.id) });
    return null;
  }
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(View, { project: db.key })));
    await act(async () => root.render(createElement(View, { project: portal.key })));
    const portalFrames = frames.filter((frame) => frame.project === portal.key);
    expect(portalFrames.length).toBeGreaterThan(0);
    for (const frame of portalFrames) expect(frame.ids).toEqual(["portal-session"]);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});

it("re-reads the list over HTTP when only its machine-channel stream fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const channel = await import("./remoteMachineChannel");
  let streamFailed: ((reason: unknown) => void) | undefined;
  const subscribe = vi
    .spyOn(channel, "subscribeRemoteMachineChannel")
    .mockImplementation((_machine, _demand, _changes, onError) => {
      streamFailed = onError;
      return () => {};
    });
  const machine = { id: "mac", name: "MacBook", environmentId: "env-mac" };
  const listReads = { count: 0 };
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_machines") return [machine];
    if ((input as { method?: string } | undefined)?.method === "sessions.list") {
      listReads.count++;
      return [{ id: "s1", projectId: "shop", revision: 1, status: "idle", updatedAt: 1 }];
    }
    return undefined;
  });
  recordRemoteCapabilities("env-mac", ["machine.changes"]);
  const project = rememberRemoteProject("env-mac", { id: "shop", cwd: "/shop", name: "shop" });
  let state: RemoteDataState | undefined;
  function View() {
    state = useRemoteProjectSessions(project.key).dataState;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(View)));
    await vi.waitFor(() => expect(state?.phase).toBe("ready"));
    const reads = listReads.count;
    await act(async () => streamFailed!(new channel.MachineChannelStreamError("stream refused")));
    await vi.waitFor(() => expect(listReads.count).toBeGreaterThan(reads));
    expect(state?.phase).toBe("ready");
    expect(state?.error).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    subscribe.mockRestore();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
