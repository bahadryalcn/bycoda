// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isConnectionFailure, presentRemoteError } from "../../connections/model/remoteFailure";
import { reportRemoteConnection } from "../../connections/model/remoteHealth";
import { CrewSidebar } from "./CrewSessions";
import { CrewWorkManager } from "./CrewWorkManager";

const feedback = vi.hoisted(() => ({ coordinated: true, query: {} as Record<string, unknown> }));
vi.mock("../../connections/ui/RemoteConnectionFeedback", () => ({
  useRemoteConnectionFeedback: (
    _cwd: string,
    failure?: Parameters<typeof isConnectionFailure>[0],
  ) => feedback.coordinated && (!failure || isConnectionFailure(failure)),
}));
vi.mock("../../connections/model/remoteHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connections/model/remoteHealth")>()),
  reportRemoteConnection: vi.fn(),
}));
vi.mock("../model/crewClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/crewClient")>()),
  useProjectCrews: () => feedback.query,
}));

// The machine picker asks the host list; these tests stay on the project's own machine.
vi.mock("./CrewMachineScope", () => ({
  useCrewMachineScope: (scopeCwd: string, state: unknown) => ({
    cwd: scopeCwd,
    state,
    picker: () => null,
    projectPicker: () => null,
  }),
}));

type CrewState = ComponentProps<typeof CrewWorkManager>["state"];
const cwd = "remote://environment/Users/owner/project";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  feedback.coordinated = true;
  feedback.query = {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderFeed(state: Partial<CrewState>) {
  feedback.query = state;
  await act(async () => root.render(createElement(CrewSidebar, { cwd, onManagedChange: vi.fn() })));
}

async function renderManager(state: Partial<CrewState>) {
  const refetch = vi.fn();
  await act(async () =>
    root.render(createElement(CrewWorkManager, { cwd, state: { refetch, ...state } as CrewState })),
  );
  return refetch;
}

function visibleFailure(error: Error) {
  return {
    error,
    visibleError: presentRemoteError(error, { graceExpired: true }),
    errorDetails: error.message,
  };
}

it("reports a pending connection failure before showing sidebar feedback", async () => {
  const error = new Error("Machine is unreachable");
  await renderFeed({ error, pendingFailure: true });
  expect(container.textContent).toBe("");
  expect(reportRemoteConnection).toHaveBeenCalledWith(cwd, "crews", error);

  await renderFeed(visibleFailure(error));
  expect(container.textContent).toContain("Not connected");
  expect(container.textContent).not.toContain("Try again");
});

it("retains the last Crew work rows during a shared connection interruption", async () => {
  const data = {
    definitions: [{ id: "definition", name: "Review team" }],
    runs: [
      {
        id: "run",
        title: "Review connection recovery",
        status: "active",
        updatedAt: 1,
        definition: { id: "definition", name: "Review team" },
        tasks: [],
        messages: [],
        assignments: [],
      },
    ],
  } as unknown as NonNullable<CrewState["data"]>;
  await renderFeed({
    data,
    error: new Error("RPC_CONNECTION_INTERRUPTED: Host connection interrupted"),
  });
  expect(container.textContent).toContain("Review connection recovery");
  expect(container.textContent).not.toContain("Try again");
  expect(container.textContent).not.toContain("Not connected");
});

it("shows Crew work only while the project has unfinished runs", async () => {
  const definition = { id: "definition", name: "Review team" };
  const run = {
    id: "run",
    title: "Review connection recovery",
    status: "active",
    updatedAt: 1,
    definition,
    tasks: [],
    messages: [],
    assignments: [],
  };
  const stateWithRuns = (runs: (typeof run)[]) => ({
    data: { definitions: [definition], runs } as unknown as NonNullable<CrewState["data"]>,
  });
  await renderFeed(stateWithRuns([]));
  expect(container.querySelector("section")).toBeNull();

  await renderFeed(stateWithRuns([run]));
  expect(container.textContent).toContain("Manage");
  expect(container.textContent).toContain(run.title);

  await renderFeed(stateWithRuns([{ ...run, status: "paused" }]));
  expect(container.textContent).toContain("Manage");

  await renderFeed(stateWithRuns([{ ...run, status: "finished" }]));
  expect(container.querySelector("section")).toBeNull();
});

it("does not report recovery before the query has a verified result", async () => {
  await renderFeed({ isSuccess: false });
  expect(reportRemoteConnection).not.toHaveBeenCalled();
  const data = { definitions: [], runs: [] } as unknown as NonNullable<CrewState["data"]>;
  await renderFeed({ data, isSuccess: true, error: null });
  expect(reportRemoteConnection).toHaveBeenCalledWith(cwd, "crews");
});

it("does not report a service failure as a lost connection", async () => {
  await renderFeed(visibleFailure(new Error("Host rejected request: Crew storage unavailable")));
  expect(reportRemoteConnection).not.toHaveBeenCalled();
});

it("offers a sidebar retry for a service failure with an empty cached collection", async () => {
  const data = { definitions: [], runs: [] } as unknown as NonNullable<CrewState["data"]>;
  const refetch = vi.fn();
  await renderFeed({
    data,
    refetch,
    ...visibleFailure(new Error("Host rejected request: Crew storage unavailable")),
  });
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  )!;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  expect(refetch).toHaveBeenCalledOnce();
});

it("keeps a service failure and its local retry in the Work tab", async () => {
  const data = { definitions: [], runs: [] } as unknown as NonNullable<CrewState["data"]>;
  const refetch = await renderManager({
    data,
    ...visibleFailure(new Error("Host rejected request: Crew storage unavailable")),
  });
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  expect(retry).toBeTruthy();
  await act(async () => retry.click());
  expect(refetch).toHaveBeenCalledOnce();
});

it("shows the presented Host failure as visible text and keeps the raw message behind Details", async () => {
  const raw = "Host rejected request: Crew storage unavailable";
  const failure = visibleFailure(new Error(raw));
  const refetch = await renderManager({ ...failure });
  // The visible sentence is the presented reason, not a button label or tooltip.
  expect(container.textContent).toContain(failure.visibleError);
  expect(container.textContent).not.toContain(raw);
  // The raw Host text is one disclosure away, and the retry stays a named button.
  const details = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Details" || button.textContent === "Show details",
  )!;
  await act(async () => details.click());
  expect(document.body.textContent).toContain(raw);
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  )!;
  await act(async () => retry.click());
  expect(refetch).toHaveBeenCalledOnce();
});

it("names the machine and action of a failed crew action and clears it once the machine answers", async () => {
  const run = {
    id: "run",
    title: "Build game",
    status: "active",
    updatedAt: 1,
    definition: { id: "definition", name: "Product team", agents: [] },
    tasks: [],
    messages: [],
    assignments: [],
  };
  const data = {
    machine: {
      id: "local",
      name: "This computer (local sync)",
      endpoint: "http://127.0.0.1:3776",
      environmentId: "local-env",
      localHost: true,
    },
    project: { id: "project", cwd, name: "project" },
    definitions: [run.definition],
    runs: [run],
    agents: [],
    catalog: { models: {}, errors: {} },
  };
  const call = vi
    .fn()
    .mockRejectedValue(
      new Error("Machine is unreachable. Check the host and SSH tunnel, then reconnect."),
    );
  const renderWork = (dataUpdatedAt: number) =>
    act(async () =>
      root.render(
        createElement(CrewWorkManager, {
          cwd,
          state: { data, call, dataUpdatedAt, refetch: vi.fn() } as unknown as CrewState,
        }),
      ),
    );
  await renderWork(1);
  const pause = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Pause"),
  )!;
  await act(async () => pause.click());
  expect(container.textContent).toContain("failed on This computer");
  expect(container.textContent).not.toContain("SSH tunnel");
  await renderWork(Date.now() + 1000);
  expect(container.textContent).not.toContain("failed on This computer");
});

it("renders the work manager inline without a modal", async () => {
  await renderManager({ error: null });
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).toContain("Loading crews…");
});
