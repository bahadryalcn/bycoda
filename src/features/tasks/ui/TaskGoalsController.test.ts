// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { deleteGoal, type BoardGoal } from "../model/goalClient";
import { goalKey } from "../model/goalClient";
import { useTaskGoals } from "./TaskGoalsController";
import { useTaskBoardOperations } from "./useTaskBoardOperations";

vi.mock("../model/goalClient", async (original) => ({
  ...(await original<typeof import("../model/goalClient")>()),
  deleteGoal: vi.fn(),
}));

it("retains epic and filter after a rejected deletion, then commits only a confirmed retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const goal = {
    id: "epic",
    machineId: "local",
    title: "Release",
    status: "cancelled",
  } as BoardGoal;
  const key = goalKey(goal.machineId, goal.id);
  const removeGoal = vi.fn();
  const refresh = vi.fn(async () => {});
  let current!: { goals: ReturnType<typeof useTaskGoals>; filter: string };
  const scope = {
    recents: [],
    machines: [],
    projectFilter: "all",
    lock: { lockedGroupIds: new Set<string>(), lockedProjectKeys: new Set<string>() },
    sprintBoard: { supported: false, setGoalContext: vi.fn() },
  } as Parameters<typeof useTaskGoals>[0]["scope"];
  function Probe() {
    const ops = useTaskBoardOperations(refresh);
    const [filter, setFilter] = useState(key);
    const goals = useTaskGoals({
      ops,
      scope,
      stored: [],
      capable: [],
      putGoal: vi.fn(),
      removeGoal,
      filter,
      setFilter,
      addRecovery: vi.fn(),
      openSession: vi.fn(),
    });
    useLayoutEffect(() => {
      current = { goals, filter };
    });
    return ops.confirmDialog;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const confirm = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent === "Delete",
    )!;
  try {
    vi.mocked(deleteGoal)
      .mockRejectedValueOnce(new Error("Stop this goal’s running tasks before deleting it."))
      .mockResolvedValueOnce(undefined);
    await act(async () => root.render(createElement(Probe)));
    await act(async () => {
      void current.goals.remove(goal);
    });
    await act(async () => confirm().click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      "Stop this goal’s running tasks",
    );
    expect(current.filter).toBe(key);
    expect(removeGoal).not.toHaveBeenCalled();
    await act(async () => confirm().click());
    expect(removeGoal).toHaveBeenCalledWith(goal);
    expect(current.filter).toBe("all");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
