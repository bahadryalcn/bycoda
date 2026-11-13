// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BranchDeliveryPlan, ManagedWorkspace } from "../model/contracts";
import { getWorkspaceCapabilities, workspaceRequest } from "../model/workspaceClient";
import { WorkspaceReview } from "./WorkspaceReview";
import { WorkspaceDirectoryRemoval } from "./WorkspaceDirectoryRemoval";
import { toast } from "../../../shared/ui/ToastRegion";

vi.mock("../model/workspaceClient", () => ({
  workspaceRequest: vi.fn(),
  getWorkspaceCapabilities: vi.fn(),
  workspaceOperationKey: () => "operation-key",
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement("div", { role: "dialog", "aria-label": title }, children, footer),
  ModalActions: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("../../../shared/i18n", () => {
  const t = (text: string, params?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => params?.[key] ?? key);
  return { t, useT: () => t };
});
const workspace: ManagedWorkspace = {
  id: "owned",
  repositoryId: "repo",
  projectId: "project",
  environmentId: "env",
  owner: { kind: "session", id: "session" },
  path: "/repo-worktrees/wt-owned",
  branchRef: "refs/heads/bycoda/s/change-owned",
  baseRef: "refs/heads/main",
  baseCommit: "a".repeat(40),
  targetBranchRef: "refs/heads/main",
  state: "finished",
  directoryState: "present",
  revision: 7,
  lastActivityAt: 1,
  pinned: false,
};
const plan: BranchDeliveryPlan = {
  token: "sha-bound-plan",
  expiresAt: Date.now() + 60000,
  workspaceId: "owned",
  expectedRevision: 7,
  sourceBranchRef: workspace.branchRef,
  sourceHead: "b".repeat(40),
  targetBranchRef: "refs/heads/main",
  targetHead: "a".repeat(40),
  targetStatusFingerprint: "dirty-target-fingerprint",
  commits: [],
  changedPaths: ["src/changed.ts"],
  overlappingPaths: [],
  checks: [{ name: "Focused checks", status: "passed" }],
  visualEvidence: [],
  blockers: [],
  action: "merge",
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(workspaceRequest).mockReset();
  vi.mocked(getWorkspaceCapabilities).mockResolvedValue([
    "workspaces.delivery.v1",
    "workspaces.pr-publication.v1",
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === label)!;
const renderReview = async () => {
  await act(async () => {
    root.render(
      createElement(WorkspaceReview, { workspace, context: { cwd: "/repo" }, onClose: vi.fn() }),
    );
  });
};

it("merges only the reviewed SHA plan and prevents duplicate owner approval", async () => {
  let finish!: () => void;
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.delivery.review") return plan as never;
    if (method === "workspaces.delivery.merge")
      return new Promise((resolve) => {
        finish = () => resolve({} as never);
      });
    throw new Error(method);
  });
  await renderReview();
  expect(container.textContent).toContain(plan.sourceHead);
  expect(container.textContent).toContain(plan.targetHead);
  expect(container.textContent).toContain(plan.targetStatusFingerprint);
  await act(async () => {
    button("Merge into main").click();
    button("Merge into main").click();
  });
  const writes = vi
    .mocked(workspaceRequest)
    .mock.calls.filter(([method]) => method === "workspaces.delivery.merge");
  expect(writes).toHaveLength(1);
  expect(writes[0][1]).toEqual({
    workspaceId: "owned",
    expectedRevision: 7,
    idempotencyKey: "operation-key",
    planToken: "sha-bound-plan",
  });
  await act(async () => finish());
  expect(container.textContent).toContain("Merged into main.");
});

it("blocks overlapping target paths and expired approval plans", async () => {
  vi.mocked(workspaceRequest).mockImplementation(
    async (method) =>
      (method === "workspaces.get"
        ? workspace
        : { ...plan, overlappingPaths: ["src/changed.ts"], expiresAt: 1 }) as never,
  );
  await renderReview();
  expect(button("Merge into main").disabled).toBe(true);
  expect(container.textContent).toContain("Overlapping target changes");
  expect(container.textContent).toContain("This review expired");
  expect(
    vi
      .mocked(workspaceRequest)
      .mock.calls.some(([method]) => method === "workspaces.delivery.merge"),
  ).toBe(false);
});

const cleanupPlan = (blockers: string[] = []) => ({
  token: "cleanup-plan",
  expiresAt: Date.now() + 60000,
  workspaceId: "owned",
  expectedRevision: 7,
  path: workspace.path,
  branchRef: workspace.branchRef,
  head: plan.sourceHead,
  statusFingerprint: "clean",
  dirty: false,
  preservationRequired: false,
  blockers,
  links: [],
});

it("closes on confirmation and settles an uncertain background removal from Host status", async () => {
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.cleanup.plan") return cleanupPlan() as never;
    if (method === "workspaces.cleanup.apply") throw new Error("Lost connection");
    if (method === "workspaces.cleanup.status")
      return { workspace: { ...workspace, directoryState: "removed" }, operations: [] } as never;
    throw new Error(method);
  });
  const close = vi.fn();
  const change = vi.fn();
  await act(async () =>
    root.render(
      createElement(WorkspaceDirectoryRemoval, {
        workspace,
        context: { cwd: "/repo" },
        onClose: close,
        onWorkspaceChange: change,
      }),
    ),
  );
  await act(async () => button("Delete directory").click());
  expect(close).toHaveBeenCalledOnce();
  expect(change).toHaveBeenLastCalledWith({ ...workspace, directoryState: "removed" });
  expect(
    vi
      .mocked(workspaceRequest)
      .mock.calls.filter(([method]) => method === "workspaces.cleanup.apply"),
  ).toHaveLength(1);
});

it("deletes before a slow preview finishes and reuses that preview in the background", async () => {
  let finishPlan!: (plan: ReturnType<typeof cleanupPlan>) => void;
  const calls: string[] = [];
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    calls.push(method);
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.cleanup.plan")
      return new Promise((resolve) => {
        finishPlan = resolve;
      }) as never;
    if (method === "workspaces.cleanup.apply") return {} as never;
    if (method === "workspaces.cleanup.status")
      return { workspace: { ...workspace, directoryState: "removed" }, operations: [] } as never;
    throw new Error(method);
  });
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(WorkspaceDirectoryRemoval, {
        workspace,
        context: { cwd: "/repo" },
        onClose: close,
      }),
    ),
  );
  // The owner is not held behind the Host's directory scan.
  expect(button("Delete directory").disabled).toBe(false);
  await act(async () => button("Delete directory").click());
  expect(close).toHaveBeenCalledOnce();
  await act(async () => finishPlan(cleanupPlan()));
  expect(calls).toEqual([
    "workspaces.get",
    "workspaces.cleanup.plan",
    "workspaces.cleanup.apply",
    "workspaces.cleanup.status",
  ]);
});

it("closes a stale active record before retiring its missing folder", async () => {
  const calls: string[] = [];
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    calls.push(method);
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.close") return { ...workspace, state: "abandoned" } as never;
    if (method === "workspaces.cleanup.plan") return cleanupPlan() as never;
    if (method === "workspaces.cleanup.apply") return {} as never;
    if (method === "workspaces.cleanup.status")
      return { workspace: { ...workspace, directoryState: "removed" }, operations: [] } as never;
    throw new Error(method);
  });
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(WorkspaceDirectoryRemoval, {
        workspace,
        context: { cwd: "/repo" },
        closeFirst: true,
        missing: true,
        onClose: close,
      }),
    ),
  );
  // Nothing is previewed or closed until the owner confirms.
  expect(calls).toEqual([]);
  await act(async () => button("Remove record").click());
  expect(calls).toEqual([
    "workspaces.get",
    "workspaces.close",
    "workspaces.cleanup.plan",
    "workspaces.cleanup.apply",
    "workspaces.cleanup.status",
  ]);
  expect(close).toHaveBeenCalledOnce();
});

it("skips filesystem cleanup when closing already retired the missing record", async () => {
  const retired = { ...workspace, state: "abandoned", directoryState: "removed" };
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.close") return retired as never;
    throw new Error(method);
  });
  const close = vi.fn();
  const changed = vi.fn();
  await act(async () =>
    root.render(
      createElement(WorkspaceDirectoryRemoval, {
        workspace,
        context: { cwd: "/repo" },
        closeFirst: true,
        missing: true,
        onClose: close,
        onWorkspaceChange: changed,
      }),
    ),
  );
  await act(async () => button("Remove record").click());
  expect(close).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledWith(retired);
  expect(vi.mocked(workspaceRequest).mock.calls.map(([method]) => method)).toEqual([
    "workspaces.get",
    "workspaces.close",
  ]);
});

it("closes the dialog at once and reports a blocker left after closing in the background", async () => {
  vi.mocked(workspaceRequest).mockImplementation(async (method) => {
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.close") return { ...workspace, state: "abandoned" } as never;
    if (method === "workspaces.cleanup.plan")
      return cleanupPlan(["Workspace is still in use."]) as never;
    throw new Error(method);
  });
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(WorkspaceDirectoryRemoval, {
        workspace,
        context: { cwd: "/repo" },
        closeFirst: true,
        missing: true,
        onClose: close,
      }),
    ),
  );
  const show = vi.spyOn(toast, "show");
  await act(async () => button("Remove record").click());
  expect(close).toHaveBeenCalledOnce();
  expect(show).toHaveBeenLastCalledWith(
    expect.objectContaining({ tone: "danger", message: "Workspace is still in use." }),
  );
  expect(vi.mocked(workspaceRequest).mock.calls.map(([method]) => method)).not.toContain(
    "workspaces.cleanup.apply",
  );
});

it("keeps the PR draft and reconciles an uncertain publication with the original operation after reopening", async () => {
  const publication = {
    repository: "owner/repo",
    remote: "origin",
    baseBranchRef: "refs/heads/main",
    headBranchRef: workspace.branchRef,
    title: "Reviewed change",
    body: "Keep this draft",
  };
  localStorage.setItem("bycoda.workspace-publication.draft.env.owned", JSON.stringify(publication));
  let failed = false;
  vi.mocked(workspaceRequest).mockImplementation(async (method, params) => {
    if (method === "workspaces.get") return workspace as never;
    if (method === "workspaces.delivery.review")
      return (
        "action" in params && params.action === "publish"
          ? { ...plan, action: "publish", publication }
          : plan
      ) as never;
    if (method === "workspaces.delivery.publish") {
      if (!failed) {
        failed = true;
        throw new Error("Unknown publication outcome");
      }
      return {
        status: "complete",
        operationId: "publication",
        workspaceId: workspace.id,
        push: { remote: "origin", sourceHead: plan.sourceHead },
        pullRequest: { number: 42, url: "https://example.test/42" },
      } as never;
    }
    throw new Error(method);
  });
  await renderReview();
  await act(async () => button("Create PR").click());
  expect(
    container.querySelector<HTMLInputElement>('input[value="Reviewed change"]'),
  ).not.toBeNull();
  await act(async () => button("Review publication").click());
  await act(async () => button("Push branch and create PR").click());
  expect(container.textContent).toContain("Unknown publication outcome");
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderReview();
  expect(button("Check publication status")).toBeDefined();
  await act(async () => button("Check publication status").click());
  const writes = vi
    .mocked(workspaceRequest)
    .mock.calls.filter(([method]) => method === "workspaces.delivery.publish");
  expect(writes).toHaveLength(2);
  expect(writes[0][1]).toEqual(writes[1][1]);
  expect(container.textContent).toContain("Pull request created.");
  expect(localStorage.getItem("bycoda.workspace-publication.attempt.env.owned")).toBeNull();
});
