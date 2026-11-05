// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../model/workspaceClient", async (original) => ({
  ...(await original<typeof import("../model/workspaceClient")>()),
  resolveWorkspaceContext: async (cwd: string) => ({
    cwd,
    projectId: "project",
    environmentId: "env",
  }),
  getWorkspaceCapabilities: async () => [
    "workspaces.managed.v1",
    "workspaces.policy.v1",
    "workspaces.lifecycle.v1",
  ],
  workspaceRequest: vi.fn(),
}));

import { workspaceRequest } from "../model/workspaceClient";
import { WorkspacePolicySettings, workspacePolicyDiskErrors } from "./WorkspacePolicySettings";

const GIB = 1_073_741_824;
const policyAt = (revision: number, defaultMode: "current" | "worktree", scopes = ["host"]) => ({
  revision,
  resolved: {
    appliedScopes: scopes,
    policy: {
      defaultMode,
      pinned: false,
      retention: {
        active: "never",
        idle: "never",
        finished: "never",
        merged: "never",
        abandoned: "never",
      },
      disk: { budgetBytes: 10 * GIB, warningRatio: 0.8, minimumFreeBytes: 5 * GIB },
    },
  },
});
const storageStatus = (materializedBytes: number) => ({
  root: "/storage",
  materializedBytes,
  budgetBytes: 10 * GIB,
  warningRatio: 0.8,
  freeBytes: 50 * GIB,
  sharedCacheBytes: 0,
  recoveryBytes: 0,
  requiredFreeBytes: 5 * GIB,
  materialization: "allowed",
});

let container: HTMLDivElement;
let root: Root;
let hostPolicy = policyAt(1, "current");
let storageFails = false;
let storageBytes = 2 * GIB;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  hostPolicy = policyAt(1, "current");
  storageFails = false;
  storageBytes = 2 * GIB;
  vi.mocked(workspaceRequest).mockImplementation((async (method: string) => {
    if (method === "workspaces.list") return [];
    if (method === "projects.workspacePolicy.get") return hostPolicy;
    if (method === "workspaces.storage.status") {
      if (storageFails) throw new Error("storage probe failed");
      return storageStatus(storageBytes);
    }
    throw new Error(`unexpected ${method}`);
  }) as never);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === text,
  );
const pinBox = () =>
  container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Pin new workspaces"]')!;
const mount = () =>
  act(async () => root.render(createElement(WorkspacePolicySettings, { cwd: "/repo" })));

it("mirrors the Host rule that every disk amount must be positive", () => {
  const disk = { budgetBytes: 10 * GIB, warningRatio: 0.8, minimumFreeBytes: 5 * GIB };
  expect(workspacePolicyDiskErrors(disk)).toEqual({});
  expect(workspacePolicyDiskErrors({ ...disk, minimumFreeBytes: 0 }).minimumFree).toBeTruthy();
  expect(
    workspacePolicyDiskErrors({ ...disk, minimumFreeBytes: Number.NaN }).minimumFree,
  ).toBeTruthy();
  expect(workspacePolicyDiskErrors({ ...disk, budgetBytes: 0.5 }).budget).toBeTruthy();
  expect(workspacePolicyDiskErrors({ ...disk, warningRatio: 1.5 }).warning).toBeTruthy();
});

it("keeps an unsaved policy draft through refresh and asks before adopting a newer Host revision", async () => {
  await mount();
  await act(async () => pinBox().click());
  expect(pinBox().getAttribute("aria-checked")).toBe("true");
  expect(button("Save workspace policy")!.disabled).toBe(false);

  hostPolicy = policyAt(2, "worktree");
  await act(async () => button("Refresh workspace status")!.click());
  expect(pinBox().getAttribute("aria-checked")).toBe("true");
  expect(container.textContent).toContain("The saved policy changed while you were editing");
  expect(button("Save workspace policy")!.disabled).toBe(true);

  await act(async () => button("Reload Host policy")!.click());
  expect(pinBox().getAttribute("aria-checked")).toBe("false");
  expect(container.textContent).not.toContain("The saved policy changed while you were editing");
});

it("adopts a newer Host policy silently when there is nothing unsaved", async () => {
  await mount();
  hostPolicy = policyAt(2, "worktree", ["host", "project"]);
  await act(async () => button("Refresh workspace status")!.click());
  expect(container.textContent).toContain("Project override");
  expect(container.textContent).not.toContain("The saved policy changed while you were editing");
});

it("labels stale storage on its own section and retries it without touching the policy draft", async () => {
  await mount();
  await act(async () => pinBox().click());
  expect(container.textContent).toContain("Workspace storage");

  storageFails = true;
  await act(async () => button("Refresh workspace status")!.click());
  expect(container.textContent).toContain("could not refresh and may be out of date");
  expect(container.textContent).toContain("storage probe failed");
  // The last good storage reading and the unsaved edit both survive.
  expect(container.textContent).toContain("Showing the last storage reading");
  expect(pinBox().getAttribute("aria-checked")).toBe("true");

  storageFails = false;
  storageBytes = 1 * GIB;
  await act(async () => button("Retry")!.click());
  expect(container.textContent).not.toContain("could not refresh and may be out of date");
  expect(container.textContent).toContain("1.0 GiB / 10.0 GiB");
  expect(pinBox().getAttribute("aria-checked")).toBe("true");
});
