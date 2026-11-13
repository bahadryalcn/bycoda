// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  reserve: vi.fn(),
  adopt: vi.fn(),
  route: vi.fn(),
  machine: vi.fn(),
  request: vi.fn(),
  load: vi.fn(),
  bindings: new Map<string, string>(),
}));
vi.mock("../../model/sessionWindowOwnership", async (original) => ({
  ...(await original<typeof import("../../model/sessionWindowOwnership")>()),
  reserveSessionWindow: api.reserve,
}));
vi.mock("../../model/windowNavigation", () => ({ routeWindowDestination: api.route }));
vi.mock("../../../features/connections/model/connections", () => ({
  remoteMachineFor: api.machine,
  remoteRequest: api.request,
  loadRemoteSession: api.load,
  remoteSessionFor: (id: string) => api.bindings.get(id),
  rememberRemoteSession: (id: string, hostId: string) => api.bindings.set(id, hostId),
}));
vi.mock("../../../features/connections/model/openLocalHostSession", () => ({
  openLocalHostSession: api.adopt,
}));
import {
  useAutomationSessionOpeners,
  type AutomationSessionOpenersDeps,
} from "./useAutomationSessionOpeners";
import { resetSessionsStore, sessionsRef } from "../../../features/sessions/model/sessionsStore";

it("hydrates the exact remote coordinator without creating or selecting a tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSessionsStore([]);
  api.bindings.clear();
  const release = vi.fn();
  api.reserve.mockResolvedValue(release);
  api.machine.mockResolvedValue({ id: "machine", environmentId: "crew-environment" });
  api.request.mockResolvedValue([{ id: "project", cwd: "/crew", name: "Crew" }]);
  api.load.mockResolvedValue({
    projectId: "project",
    status: "idle",
    session: {
      id: "lead",
      cwd: "/crew",
      blocks: [],
      runtimeMode: "supervised",
      harness: "codex",
      model: "fixture",
    },
  });
  const navigate = vi.fn();
  const deps = {
    toolWindow: null,
    setServersViewOpen: navigate,
    setSettingsOpen: navigate,
    setRecents: navigate,
    onSelectRemoteSession: navigate,
  } as unknown as AutomationSessionOpenersDeps;
  let actions!: ReturnType<typeof useAutomationSessionOpeners>;
  function Fixture() {
    actions = useAutomationSessionOpeners(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Fixture)));
  const target = {
    machineId: "machine",
    projectId: "project",
    sessionId: "lead",
    cwd: "remote://crew-environment/crew",
  };
  await act(async () => actions.onOpenBackgroundSession(target, true, true));
  expect(api.reserve).toHaveBeenCalledWith(['remote-session:["crew-environment","lead"]']);
  expect(api.load).toHaveBeenCalledWith("machine", "lead");
  expect(navigate).not.toHaveBeenCalled();
  expect(sessionsRef.current).toHaveLength(1);
  const id = sessionsRef.current[0]!.id;
  expect(api.bindings.get(id)).toBe("lead");
  await act(async () => actions.onOpenBackgroundSession(target, true, true));
  expect(sessionsRef.current.map((session) => session.id)).toEqual([id]);
  await act(async () => root.unmount());
  resetSessionsStore([]);
  vi.unstubAllGlobals();
});

it("adopts an inline coordinator without changing the selected workspace surface", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const release = vi.fn();
  api.reserve.mockResolvedValue(release);
  api.adopt.mockResolvedValue({ sessionId: "lead", cwd: "/crew" });
  const navigate = vi.fn();
  const deps = {
    toolWindow: null,
    setServersViewOpen: navigate,
    onSelectHistorySession: navigate,
  } as unknown as AutomationSessionOpenersDeps;
  let actions!: ReturnType<typeof useAutomationSessionOpeners>;
  function Fixture() {
    actions = useAutomationSessionOpeners(deps);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Fixture)));
  await act(async () =>
    actions.onOpenBackgroundSession(
      { machineId: "local", projectId: "p", sessionId: "lead", cwd: "/crew" },
      true,
      true,
    ),
  );
  expect(api.adopt).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "lead", projectId: "p" }),
    expect.any(Object),
  );
  expect(navigate).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledWith(true);
  await act(async () => root.unmount());
  api.adopt.mockClear();
  vi.unstubAllGlobals();
});

it("does not adopt a local Host session when another window owns it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.route.mockResolvedValue(false);
  api.reserve.mockResolvedValue(null);
  const root = createRoot(document.createElement("div"));
  let actions!: ReturnType<typeof useAutomationSessionOpeners>;
  const deps = { toolWindow: null } as unknown as AutomationSessionOpenersDeps;
  function Fixture() {
    actions = useAutomationSessionOpeners(deps);
    return null;
  }
  await act(async () => root.render(createElement(Fixture)));
  await act(async () =>
    actions.onOpenBackgroundSession({
      machineId: "local",
      cwd: "/repo",
      projectId: "p",
      sessionId: "s",
    }),
  );
  expect(api.reserve).toHaveBeenCalledWith(["s"]);
  expect(api.adopt).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
