// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import { useAutomationLaunch, type AutomationLaunchDeps } from "./useAutomationLaunch";
import {
  newAutomationDraft,
  type Automation,
  type AutomationRun,
} from "../../../features/automations/model/automations";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../../features/automations/model/automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../features/automations/model/automations")>()),
  updateAutomationRun: mocks.update,
}));

it("never submits a recovered SSH runbook through the agent automation launcher", async () => {
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
  };
  let launch!: ReturnType<typeof useAutomationLaunch>["launchAutomation"];
  function Harness() {
    launch = useAutomationLaunch(deps).launchAutomation;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    // Deliberately omit agent fields: the SSH guard must run before consulting
    // project, harness, reservation, session or submission machinery.
    const run = { id: "recovered-run", trigger: "scheduled" } as AutomationRun;
    await launch({ id: "book", executor: "ssh" } as Automation, run, true);
    await launch({ id: "book", sshRunbook: { revision: 1 } } as Automation, run, true);
    expect(action).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("does not alter or submit a run when another launcher already claimed it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.update
    .mockReset()
    .mockRejectedValue(new Error("Invalid automation run status transition."));
  const action = vi.fn();
  const deps = {
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
  } as AutomationLaunchDeps;
  let launch!: ReturnType<typeof useAutomationLaunch>["launchAutomation"];
  function Harness() {
    launch = useAutomationLaunch(deps).launchAutomation;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Harness)));
    const execution = {
      harness: "claude" as const,
      model: "claude:stored",
      modelSettings: { effort: "high" },
      providerAccountId: "work",
    };
    const automation: Automation = {
      ...newAutomationDraft("/project", "claude", "claude:stored"),
      ...execution,
      id: "a",
      createdAt: 1,
      updatedAt: 1,
      nextRunAt: 1,
    };
    const run: AutomationRun = {
      id: "r",
      automationId: "a",
      trigger: "scheduled",
      status: "pending",
      scheduledFor: 1,
      createdAt: 1,
      execution,
      maxRunMinutes: 12,
    };
    const sessionsBefore = sessionsRef.current;
    await expect(launch(automation, run)).rejects.toThrow(
      "Invalid automation run status transition.",
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("r", "running", {
      execution,
      maxRunMinutes: 12,
    });
    expect(sessionsRef.current).toBe(sessionsBefore);
    expect(action).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
