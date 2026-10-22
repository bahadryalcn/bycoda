// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const warm = vi.hoisted(() => vi.fn());
vi.mock("../../skills/model/skills", () => ({
  warmNativeSkills: warm,
  hasNativeCommands: () => true,
}));
import { useNativeSkillWarmup } from "./useNativeSkillWarmup";
it("warms a changed worktree but leaves identical stream-frame context alone", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  function Owner({ worktree }: { worktree: string }) {
    useNativeSkillWarmup({ id: "thread", cwd: "/repo", harness: "pi", worktreeCwd: worktree });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Owner, { worktree: "/first" })));
    await act(async () => root.render(createElement(Owner, { worktree: "/first" })));
    expect(warm).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Owner, { worktree: "/second" })));
    expect(warm).toHaveBeenLastCalledWith({ harness: "pi", cwd: "/second", sessionId: "thread" });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
