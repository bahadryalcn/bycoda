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

it("opens Accounts on the account named by the sign-in target", async () => {
  const model = await import("../../../features/social/model/socialNavigation");
  backgroundTargetAction("background:social-accounts:acc-1", actions())?.();
  expect(model.takeSocialScreenRequest()).toEqual({
    screen: "accounts",
    target: { accountId: "acc-1" },
  });
  backgroundTargetAction("background:social-accounts", actions())?.();
  expect(model.takeSocialScreenRequest()).toEqual({ screen: "accounts", target: undefined });
  expect(model.takeSocialScreenRequest()).toBeNull();
});

it("opens the Social panel without a project and shows its Command screen", async () => {
  const panel = vi.fn((event: Event) => (event as CustomEvent<{ cwd: string }>).detail.cwd);
  const screen = vi.fn();
  window.addEventListener("bycoda:open-social-panel", panel);
  window.addEventListener("bycoda:social-screen", screen);
  backgroundTargetAction("background:social", actions())?.();
  expect(panel).toHaveReturnedWith("");
  expect(screen).toHaveBeenCalled();
  const { takeSocialScreenRequest } =
    await import("../../../features/social/model/socialNavigation");
  expect(takeSocialScreenRequest()).toEqual({ screen: "command", target: undefined });
});
