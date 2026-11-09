// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostProject, RemoteMachine } from "../../../connections/model/protocol";
import { useSocialWorkspace, type SocialWorkspace } from "./useSocialWorkspace";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteRequest: vi.fn(),
  sectionSnapshot: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../../connections/model/connections", () => ({ remoteRequest: mocks.remoteRequest }));
vi.mock("../../model/socialClient", () => ({
  socialClient: (machineId: string) => ({
    machineId,
    sectionSnapshot: (input: unknown) => mocks.sectionSnapshot(machineId, input),
  }),
}));
// This computer is identified by its id here; the real check reads the local endpoint.
vi.mock("../../../connections/model/localSync", () => ({
  isLocalSyncMachine: (machine: { id: string }) => machine.id === "local",
}));

const SAVED_HOST_KEY = "bycoda.social.host";
const machine = (id: string) =>
  ({ id, name: id, endpoint: "", environmentId: `${id}-env` }) as unknown as RemoteMachine;

let element: HTMLDivElement, root: Root;
let latest: SocialWorkspace;
let machines: RemoteMachine[];
let projectsByHost: Record<string, HostProject[]>;

function Probe({ cwd }: { cwd: string }) {
  latest = useSocialWorkspace(cwd);
  return null;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(cwd = "/work/brand") {
  await act(async () => {
    root.render(createElement(Probe, { cwd }));
  });
  await flush();
}

function snapshotOf(patch: Record<string, unknown> = {}) {
  return { snapshot: { hostOnline: true, aiStopped: false, ...patch } };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  machines = [machine("m1"), machine("m2")];
  projectsByHost = {};
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "remote_machines") return machines;
    if (command === "social_authority_status") return {};
    return undefined;
  });
  mocks.remoteRequest
    .mockReset()
    .mockImplementation(async (id: string, method: string) =>
      method === "projects.list" ? (projectsByHost[id] ?? []) : undefined,
    );
  mocks.sectionSnapshot.mockReset().mockImplementation(async () => snapshotOf());
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

it("connects this computer, lists the Hosts and reads the first Host's scheduler state", async () => {
  await mount();
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
    "local_host_connect",
    "remote_machines",
    "social_authority_status",
  ]);
  expect(latest.machines.map((item) => item.id)).toEqual(["m1", "m2"]);
  expect(latest.machineId).toBe("m1");
  expect(latest.client).not.toBeNull();
  expect(latest.loaded).toBe(true);
  expect(latest.shell).toEqual({ hostOnline: true, unreachable: false, aiStopped: false });
  expect(latest.error).toBe("");
  expect(mocks.sectionSnapshot).toHaveBeenCalledWith("m1", { section: "accounts", limit: 1 });
});

it("shows no connection error while Hosts are still being discovered", async () => {
  let release!: (list: RemoteMachine[]) => void;
  mocks.invoke.mockImplementation((command: string) =>
    command === "remote_machines"
      ? new Promise<RemoteMachine[]>((resolve) => {
          release = resolve;
        })
      : Promise.resolve({}),
  );
  await mount();
  expect(latest.error).toBe("");
  expect(latest.loaded).toBe(false);
  await act(async () => release(machines));
  await flush();
  expect(latest.error).toBe("");
  expect(latest.machineId).toBe("m1");
});

it("prefers the authority Host over the saved Host and this computer", async () => {
  machines = [machine("local"), machine("m1"), machine("m2")];
  localStorage.setItem(SAVED_HOST_KEY, "m1");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "remote_machines") return machines;
    if (command === "social_authority_status") return { authorityMachineId: "m2" };
    return undefined;
  });
  await mount();
  expect(latest.machineId).toBe("m2");
});

it("keeps working when the authority status or the local connect fails", async () => {
  machines = [machine("local"), machine("m1")];
  localStorage.setItem(SAVED_HOST_KEY, "m1");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "remote_machines") return machines;
    throw new Error(`${command} failed`);
  });
  mocks.invoke.mockImplementationOnce(async () => {
    throw new Error("local_host_connect failed");
  });
  await mount();
  expect(latest.machineId).toBe("m1");
  expect(latest.error).toBe("");
});

it("falls back to this computer when the saved Host no longer exists", async () => {
  machines = [machine("m1"), machine("local")];
  localStorage.setItem(SAVED_HOST_KEY, "gone");
  await mount();
  expect(latest.machineId).toBe("local");
});

it("explains that no Host is connected and exposes no client", async () => {
  machines = [];
  await mount();
  expect(latest.machineId).toBe("");
  expect(latest.client).toBeNull();
  expect(latest.error).toContain("Connect a bycoda Host for Social Media.");
  expect(mocks.sectionSnapshot).not.toHaveBeenCalled();
});

it("reports a discovery failure and recovers after an explicit retry", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "remote_machines") throw new Error("offline");
    return undefined;
  });
  await mount();
  expect(latest.error).toBe("Could not connect to the bycoda Host.");
  expect(latest.client).toBeNull();
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "remote_machines" ? machines : {},
  );
  await act(async () => latest.retry());
  await flush();
  expect(latest.error).toBe("");
  expect(latest.machineId).toBe("m1");
  expect(latest.loaded).toBe(true);
});

it("marks the Host unreachable and offline when its snapshot cannot be read, then clears it on retry", async () => {
  mocks.sectionSnapshot.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(latest.loaded).toBe(true);
  expect(latest.shell).toEqual({ hostOnline: false, unreachable: true, aiStopped: false });
  await act(async () => latest.retry());
  await flush();
  expect(latest.shell).toEqual({ hostOnline: true, unreachable: false, aiStopped: false });
});

it("reads the Host's AI stop and offline scheduler as reported", async () => {
  mocks.sectionSnapshot.mockResolvedValue(snapshotOf({ hostOnline: false, aiStopped: true }));
  await mount();
  expect(latest.shell).toEqual({ hostOnline: false, unreachable: false, aiStopped: true });
});

it("does not mark the workspace loaded when the Host returns no snapshot", async () => {
  mocks.sectionSnapshot.mockResolvedValue({ snapshot: null });
  await mount();
  expect(latest.loaded).toBe(false);
});

it("follows the working folder's project until the owner chooses a project or all projects", async () => {
  projectsByHost.m1 = [
    { id: "p1", name: "Brand", cwd: "/work/brand" },
    { id: "p2", name: "Other", cwd: "/work/other" },
  ];
  await mount("/work/brand");
  expect(latest.projectId).toBe("p1");
  await act(async () => latest.selectWorkspace({ machineId: "m1", projectId: "p2" }));
  expect(latest.projectId).toBe("p2");
  await act(async () => latest.selectWorkspace({ machineId: "m1" }));
  expect(latest.projectId).toBeUndefined();
});

it("keeps every Host's choices and scheduler facts apart and remembers the chosen Host", async () => {
  projectsByHost.m1 = [{ id: "p1", name: "Brand", cwd: "/work/brand" }];
  mocks.sectionSnapshot.mockImplementation(async (id: string) =>
    snapshotOf({ aiStopped: id === "m2" }),
  );
  await mount();
  expect(latest.shellFor("m1").aiStopped).toBe(false);
  await act(async () => latest.selectWorkspace({ machineId: "m2", projectId: "p-other" }));
  await flush();
  expect(latest.machineId).toBe("m2");
  expect(localStorage.getItem(SAVED_HOST_KEY)).toBe("m2");
  expect(latest.shell.aiStopped).toBe(true);
  expect(latest.shellFor("m1").aiStopped).toBe(false);
  expect(latest.projectFor("m2")).toBe("p-other");
  expect(latest.projectFor("m1")).toBe("p1");
  await act(async () => latest.selectWorkspace({ machineId: "m1" }));
  await flush();
  expect(latest.machineId).toBe("m1");
  expect(latest.projectFor("m2")).toBe("p-other");
});

it("changes only the selected Host when the owner stops or resumes AI", async () => {
  await mount();
  await act(async () => latest.setAiStopped(true));
  expect(latest.shellFor("m1").aiStopped).toBe(true);
  expect(latest.shellFor("m2").aiStopped).toBe(false);
  await act(async () => latest.setAiStopped(false));
  expect(latest.shell.aiStopped).toBe(false);
});

it("drops a snapshot that arrives for a Host the owner has already left", async () => {
  let late!: (value: ReturnType<typeof snapshotOf>) => void;
  mocks.sectionSnapshot.mockImplementation((id: string) =>
    id === "m1"
      ? new Promise((resolve) => {
          late = resolve;
        })
      : Promise.resolve(snapshotOf()),
  );
  await mount();
  await act(async () => latest.selectWorkspace({ machineId: "m2" }));
  await flush();
  await act(async () => late(snapshotOf({ aiStopped: true })));
  await flush();
  expect(latest.shellFor("m1").aiStopped).toBe(false);
  expect(latest.shellFor("m2").aiStopped).toBe(false);
  expect(latest.machineId).toBe("m2");
});

it("still works when the project list cannot be read", async () => {
  mocks.remoteRequest.mockRejectedValue(new Error("offline"));
  await mount();
  expect(latest.projects).toEqual([]);
  expect(latest.projectId).toBeUndefined();
  expect(latest.loaded).toBe(true);
});
