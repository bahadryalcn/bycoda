import { expect, it } from "vitest";
import { taskWorkspaceState, type ManagedTaskState } from "./taskWorkspaceState";
import type { HostTask } from "../../tasks/model/hostTasks";
const task = (fields: Partial<HostTask & ManagedTaskState>) =>
  ({ status: "review", ...fields }) as HostTask & ManagedTaskState;
it("does not equate finished implementation with delivery", () => {
  expect(taskWorkspaceState(task({}))).toMatchObject({
    finished: true,
    completion: "Implementation finished",
    delivery: "Not delivered",
  });
  expect(taskWorkspaceState(task({ merged: true }))).toMatchObject({ delivery: "Delivered" });
});
it("requires renewed approval for persisted automatic delivery preferences", () => {
  for (const fields of [
    { deliveryApprovalRequired: true },
    { deliveryState: "awaitingOwner" as const },
    { autoMerge: true },
    { deliveryRequested: true },
    { autoMergeSuspended: true },
  ])
    expect(taskWorkspaceState(task(fields)).needsRenewedApproval).toBe(true);
  expect(taskWorkspaceState(task({ autoMerge: true, merged: true })).needsRenewedApproval).toBe(
    false,
  );
});
it("uses durable Host finalization and keeps pending artifact delivery blocked", () => {
  expect(
    taskWorkspaceState(
      task({ status: "blocked", finalization: { head: "head" } as HostTask["finalization"] }),
    ),
  ).toMatchObject({
    finished: true,
    completion: "Implementation finished",
    delivery: "Not delivered",
  });
  expect(taskWorkspaceState(task({ merged: true, artifactDeliveryPending: true }))).toMatchObject({
    delivery: "Delivery is blocked",
  });
});
