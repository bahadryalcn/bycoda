// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { CrewSidebar } from "./CrewSessions";

vi.mock("../../connections/ui/RemoteConnectionFeedback", () => ({
  useRemoteConnectionFeedback: () => false,
}));
vi.mock("../../connections/model/remoteHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connections/model/remoteHealth")>()),
  reportRemoteConnection: vi.fn(),
}));
vi.mock("./CrewMachineScope", () => ({
  useCrewMachineScope: (scopeCwd: string, state: unknown) => ({
    cwd: scopeCwd,
    state,
    picker: () => null,
    projectPicker: () => null,
  }),
}));
// A new data object on every render, as the crew query produced before its memo.
vi.mock("../model/crewClient", () => ({
  useProjectCrews: () => ({
    isSuccess: true,
    refetch: vi.fn(),
    data: {
      machine: { id: "m" },
      project: { id: "p" },
      runs: [{ id: "r", status: "finished", coordinatorSessionId: "lead", tasks: [] }],
      definitions: [],
      agents: [],
    },
  }),
}));

it("tells the sidebar and the connection health only about real changes", async () => {
  // Each report or managed-session update re-renders the sidebar; reacting to every
  // new data object looped the Mac's sidebar forever (React #185).
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onManagedChange = vi.fn();
  let rerender!: () => void;
  function Parent() {
    const [, setTick] = useState(0);
    rerender = () => setTick((tick) => tick + 1);
    return createElement(CrewSidebar, {
      cwd: "remote://environment/Users/owner/project",
      onOpen: vi.fn(),
      onManagedChange,
    });
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Parent)));
    for (let index = 0; index < 5; index++) await act(async () => rerender());
    expect(onManagedChange).toHaveBeenCalledOnce();
    expect(onManagedChange).toHaveBeenCalledWith("remote://environment/Users/owner/project", [
      "lead",
    ]);
    expect(reportRemoteConnection).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
