// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  listRuns: vi.fn(async (): Promise<unknown[]> => []),
  updateRun: vi.fn(async (_id: string, status: string) => ({ status })),
}));
vi.mock("../../../features/automations/model/automations", () => ({
  listAutomationRuns: api.listRuns,
  updateAutomationRun: api.updateRun,
}));
vi.mock("../../../features/group-lock/model/groupLock", () => ({
  isProjectPasswordLocked: () => false,
}));
import { useAutomationLaunch, type AutomationLaunchDeps } from "./useAutomationLaunch";
import type { Automation, AutomationRun } from "../../../features/automations/model/automations";
import { PREVIOUS_RUN_SKIP } from "../../../features/automations/model/automationLimits";
import { newDefaultSession } from "../../../features/sessions/model/session";
import { resetSessionsStore } from "../../../features/sessions/model/sessionsStore";

const roots: Root[] = [];

function mount(overrides: Partial<AutomationLaunchDeps> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const action = vi.fn();
  const deps: AutomationLaunchDeps = {
    appendTab: action,
    focusOpenSession: action,
    submitSession: action,
    setActiveTabId: action,
    setComposerFocused: action,
    setSearchViewOpen: action,
    setInboxViewOpen: action,
    setNotesViewOpen: action,
    setAutomationsViewOpen: action,
    setServersViewOpen: action,
    setSidebarTab: action,
    onStopRef: { current: action },
    ...overrides,
  };
  let launch!: ReturnType<typeof useAutomationLaunch>["launchAutomation"];
  function Harness() {
    launch = useAutomationLaunch(deps).launchAutomation;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  return {
    action,
    deps,
    render: () => act(async () => root.render(createElement(Harness))),
    launch: () => launch,
  };
}

/** An automation that reuses the idle session already in the store, so a
 * launch needs no provider defaults. */
function reusingAutomation(extra: Partial<Automation> = {}): Automation {
  const session = {
    ...newDefaultSession("/project"),
    id: "idle-session",
    harness: "codex" as const,
  };
  resetSessionsStore([session]);
  return {
    id: "automation",
    name: "Nightly",
    prompt: "Review the project",
    harness: "codex",
    model: "model",
    cwd: "/project",
    reuseSession: true,
    lastSessionId: session.id,
    runtimeMode: "supervised",
    triggerKind: "time",
    triggerEvent: "",
    scheduleKind: "hourly",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    missedRunGraceMinutes: 720,
    enabled: true,
    nextRunAt: 0,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as Automation;
}

const scheduledRun: AutomationRun = {
  id: "claimed-run",
  automationId: "automation",
  trigger: "scheduled",
  scheduledFor: 0,
  createdAt: 0,
  status: "pending",
};

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  resetSessionsStore([]);
  api.listRuns.mockReset();
  api.listRuns.mockResolvedValue([]);
  api.updateRun.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("never submits a recovered SSH runbook through the agent automation launcher", async () => {
  const { action, render, launch } = mount();
  await render();
  // Deliberately omit agent fields: the SSH guard must run before consulting
  // project, harness, reservation, session or submission machinery.
  const run = { id: "recovered-run", trigger: "scheduled" } as AutomationRun;
  await launch()({ id: "book", executor: "ssh" } as Automation, run, true);
  await launch()({ id: "book", sshRunbook: { revision: 1 } } as Automation, run, true);
  expect(action).not.toHaveBeenCalled();
  expect(api.listRuns).not.toHaveBeenCalled();
});

it("skips a claimed occurrence while an earlier run of the automation is still going", async () => {
  api.listRuns.mockResolvedValue([
    { id: "earlier-run", status: "running" },
    { id: scheduledRun.id, status: "pending" },
  ]);
  const submitSession = vi.fn();
  const { render, launch } = mount({ submitSession });
  await render();
  await launch()(reusingAutomation(), scheduledRun);
  expect(api.updateRun).toHaveBeenCalledTimes(1);
  expect(api.updateRun).toHaveBeenCalledWith(scheduledRun.id, "skipped", {
    error: PREVIOUS_RUN_SKIP,
  });
  expect(submitSession).not.toHaveBeenCalled();
});

it("starts nothing for a run that another window or the recovery pass already settled", async () => {
  api.listRuns.mockResolvedValue([{ id: scheduledRun.id, status: "cancelled" }]);
  const submitSession = vi.fn();
  const { render, launch } = mount({ submitSession });
  await render();
  await launch()(reusingAutomation(), scheduledRun);
  expect(api.updateRun).not.toHaveBeenCalled();
  expect(submitSession).not.toHaveBeenCalled();
});

it("measures the run time limit on the monotonic clock so sleep does not stop a run", async () => {
  vi.useFakeTimers();
  let monotonic = 5_000;
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  const onStop = vi.fn();
  const submitSession = vi.fn(() => new Promise<never>(() => undefined));
  const { render, launch } = mount({ submitSession, onStopRef: { current: onStop } });
  await render();
  void launch()(reusingAutomation({ maxRunMinutes: 30 }), scheduledRun).catch(() => undefined);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(api.updateRun).toHaveBeenCalledWith(scheduledRun.id, "running", {
    sessionId: "idle-session",
  });
  expect(submitSession).toHaveBeenCalledTimes(1);
  // The machine sleeps for three hours: the wall clock jumps, the run did not progress.
  vi.setSystemTime(Date.now() + 3 * 60 * 60_000);
  monotonic += 10 * 60_000;
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(onStop).not.toHaveBeenCalled();
  monotonic += 20 * 60_000;
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(onStop).toHaveBeenCalledWith("idle-session");
  expect(onStop).toHaveBeenCalledTimes(1);
});
