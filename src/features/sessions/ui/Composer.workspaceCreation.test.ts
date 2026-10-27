// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  status: null as unknown,
  error:
    "Update bycoda Host on this project's machine to use managed workspaces. Your project checkout will not be used as a fallback.",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "local_host_bundle_status" ? host.status : [],
  ),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({
    branches: { current: "main", detached: false, branches: [] },
    settled: true,
  }),
}));
vi.mock("../../workspaces/model/workspaceCreation", () => ({
  shortWorkspaceRef: (ref: string) => ref,
  useWorkspaceCreation: (_cwd: string, _active: boolean, choice?: string) => ({
    mode: choice ?? "worktree",
    error: choice === "current" ? undefined : host.error,
    pending: false,
    refresh: vi.fn(),
  }),
}));

import { Composer } from "./Composer";
import type { WorkspaceMode } from "../model/session";

let container: HTMLDivElement;
let root: Root;
let submit: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host.status = null;
  submit = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function draw(props: Partial<ComponentProps<typeof Composer>> = {}) {
  function Draft() {
    const [mode, setMode] = useState<WorkspaceMode | undefined>(props.workspaceMode);
    return createElement(Composer, {
      focused: false,
      harness: "codex",
      model: "gpt-5.4",
      runtimeMode: "supervised",
      cwd: "/repo",
      executionCwd: "/repo",
      initialDraft: "Preserve this draft",
      draftWorkspace: true,
      branch: "main",
      onFocus: vi.fn(),
      onCwdChange: vi.fn(),
      onModelChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
      onSubmit: submit,
      onWorktreeBaseChange: vi.fn(),
      ...props,
      workspaceMode: mode,
      onWorkspaceModeChange: setMode,
    });
  }
  await act(async () => root.render(createElement(Draft)));
}
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label || entry.getAttribute("aria-label") === label,
  );

it("lets an explicit current choice send on an older remote Host", async () => {
  await draw({
    cwd: "remote://older/repo",
    executionCwd: "remote://older/repo",
    workspaceMode: "current",
  });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Send")?.disabled).toBe(false);
  await act(async () => button("Send")!.click());
  expect(submit).toHaveBeenCalledWith("Preserve this draft", [], expect.anything());
});

it("explains an idle-gated update and makes the draft's explicit current choice actionable", async () => {
  host.status = {
    state: "deferred",
    message: "The host update waits until running sessions finish.",
  };
  await draw();
  expect(container.textContent).toContain(
    "The Host update on this computer is waiting for active sessions to finish and will install automatically.",
  );
  expect(button("Send")?.disabled).toBe(true);
  await act(async () => button("Use current checkout")!.click());
  expect(container.querySelector("textarea")?.value).toBe("Preserve this draft");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Send")?.disabled).toBe(false);
});

it.each([
  null,
  { state: "failed", message: "Installation failed" },
  { state: "deferred", message: "Could not check whether the host is busy." },
  { state: "deferred", message: "The failed host installation will retry in 30 seconds." },
])("retains the update requirement without claiming active sessions for %j", async (status) => {
  host.status = status;
  await draw({ workspaceMode: "worktree" });
  expect(container.textContent).toContain(host.error);
  expect(container.textContent).not.toContain("will install automatically");
  expect(button("Use current checkout")).toBeDefined();
  expect(button("Send")?.disabled).toBe(true);
});

it("does not describe a local pending update as the remote machine's update", async () => {
  host.status = {
    state: "deferred",
    message: "The host update waits until running sessions finish.",
  };
  await draw({ cwd: "remote://older/repo", executionCwd: "remote://older/repo" });
  expect(container.textContent).not.toContain("will install automatically");
  expect(button("Send")?.disabled).toBe(true);
});
