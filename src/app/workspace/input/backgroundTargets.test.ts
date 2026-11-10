// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import {
  backgroundTargetAction,
  OPEN_BACKGROUND_TARGET_EVENT,
  requestBackgroundTarget,
} from "./backgroundTargets";

const requestSummaryPanel = vi.hoisted(() => vi.fn());
vi.mock("../../../features/tasks/model/dailySummaryClient", () => ({ requestSummaryPanel }));

const actions = () => ({ onOpenTasks: vi.fn(), onOpenAutomations: vi.fn(), openSettings: vi.fn() });

it("maps every background target to the view it opens and leaves conversations alone", () => {
  const a = actions();
  backgroundTargetAction("background:tasks", a)?.();
  backgroundTargetAction("background:automations", a)?.();
  backgroundTargetAction("background:account", a)?.();
  backgroundTargetAction("background:summary", a)?.();
  expect(a.onOpenTasks).toHaveBeenCalledTimes(2);
  expect(a.onOpenAutomations).toHaveBeenCalledTimes(1);
  expect(a.openSettings).toHaveBeenCalledWith("account");
  expect(requestSummaryPanel).toHaveBeenCalledTimes(1);
  const opened = vi.fn();
  window.addEventListener("bycoda:open-assistant", opened);
  backgroundTargetAction("background:assistant", a)?.();
  backgroundTargetAction("", a)?.();
  expect(opened).toHaveBeenCalledTimes(2);
  expect(backgroundTargetAction("session-1", a)).toBeNull();
});

it("requests a target through a window event", () => {
  const heard = vi.fn((event: Event) => (event as CustomEvent<string>).detail);
  window.addEventListener(OPEN_BACKGROUND_TARGET_EVENT, heard);
  requestBackgroundTarget("background:tasks");
  expect(heard).toHaveReturnedWith("background:tasks");
});
