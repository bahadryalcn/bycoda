// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CreationProgressView } from "../model/creationProgress";
import { WorkspaceCreationStatus } from "./WorkspaceCreationStatus";

const hook = vi.hoisted(() => ({ progress: vi.fn(), cancel: vi.fn() }));
vi.mock("../model/creationProgress", () => ({
  useCreationProgress: hook.progress,
  cancelCreation: hook.cancel,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hook.progress.mockReset();
  hook.cancel.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(view: CreationProgressView, progressId: string | null = "p1") {
  hook.progress.mockReturnValue(view);
  act(() =>
    root.render(
      createElement(WorkspaceCreationStatus, {
        progressId,
        context: { cwd: "/work/app" },
        pending: false,
        onRetry: vi.fn(),
      }),
    ),
  );
}
const stage = (id: string) => container.querySelector<HTMLElement>(`[data-stage="${id}"]`);

it("shows each stage with its status, percent and repository count", () => {
  render({
    phase: "running",
    stages: [
      { id: "fetch", status: "done" },
      {
        id: "checkout",
        status: "running",
        percent: 42.4,
        repositoryIndex: 2,
        repositoryCount: 3,
      } as never,
      { id: "submodules", status: "skipped" },
      { id: "setup", status: "pending" },
      { id: "agent", status: "pending" },
    ],
  });
  expect(container.textContent).toContain("Creating the workspace…");
  expect(stage("fetch")?.dataset.status).toBe("done");
  expect(stage("checkout")?.textContent).toContain("repository 2 of 3");
  expect(
    stage("checkout")?.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow"),
  ).toBe("42.4");
  expect(stage("submodules")).toBeNull();
  expect(stage("setup")?.dataset.status).toBe("pending");
});

it("shows an indeterminate bar while the checkout has no percent", () => {
  render({ phase: "running", stages: [{ id: "checkout", status: "running" }] });
  const bar = stage("checkout")?.querySelector("[role=progressbar]");
  expect(bar).not.toBeNull();
  expect(bar?.hasAttribute("aria-valuenow")).toBe(false);
});

it("cancels through the progress id and context, once", async () => {
  hook.cancel.mockResolvedValue({ progressId: "p1", phase: "cancelled", stages: [] });
  render({ phase: "running", stages: [{ id: "fetch", status: "running" }] });
  const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
  await act(async () => cancel.click());
  expect(hook.cancel).toHaveBeenCalledExactlyOnceWith("p1", { cwd: "/work/app" });
});

it("reports a failed cancel and offers no Cancel once the creation ended", async () => {
  hook.cancel.mockRejectedValue(new Error("offline"));
  render({ phase: "running", stages: [] });
  const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
  await act(async () => cancel.click());
  expect(container.textContent).toContain("Could not cancel the creation.");
  render({ phase: "failed", stages: [{ id: "checkout", status: "failed" }] });
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Cancel")).toBe(
    false,
  );
  expect(stage("checkout")?.dataset.status).toBe("failed");
});

it("renders nothing when idle or done", () => {
  render({ phase: null, stages: [] }, null);
  expect(container.innerHTML).toBe("");
  render({ phase: "done", stages: [] });
  expect(container.innerHTML).toBe("");
});
