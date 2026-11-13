// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { RemoteMachine } from "../../connections/model/protocol";
import {
  automationProposalSnapshot,
  closeAutomationProposal,
  openAutomationProposal,
  saveAutomationProposal,
} from "./automationProposalStore";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn(), machine: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../connections/model/connections", () => ({ remoteRequest: mocks.request }));
vi.mock("../../tasks/model/taskClient", () => ({ taskMachineFor: mocks.machine }));
const machine = {
  id: "original-machine",
  environmentId: "original-environment",
  name: "Original Host",
} as RemoteMachine;
const proposal = {
  operationId: "",
  projectId: "project",
  name: "Review",
  instruction: "Review this project",
  schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 },
  timeZone: "Europe/Istanbul",
  outputTarget: "projectTask",
  confirmationRequired: true,
  preview: { timeZone: "Europe/Istanbul", nextRunAt: 123456 },
};
beforeEach(() => {
  closeAutomationProposal();
  window.localStorage.clear();
  mocks.invoke.mockReset().mockResolvedValue([machine]);
  mocks.machine.mockReset().mockReturnValue(machine);
  mocks.request
    .mockReset()
    .mockImplementation(
      async (_machine: string, method: string, params: Record<string, unknown>) => {
        if (method === "projects.list") return [{ id: "project", cwd: "/repo" }];
        if (method === "environment.describe")
          return { capabilities: ["automations.project-tasks", "automations.room.v1"] };
        if (method === "automations.propose")
          return { ...proposal, operationId: params.operationId };
        throw new Error(`Unexpected ${method}`);
      },
    );
});
async function open() {
  const session = newSession("codex", "/repo");
  expect(openAutomationProposal(session, "Review daily at 09:00")).toBe(true);
  await vi.waitFor(() => expect(automationProposalSnapshot()?.status).toBe("review"));
  return session;
}
it("prepares then cancels with zero recurring definitions or save requests", async () => {
  await open();
  expect(mocks.request.mock.calls.some((call) => call[1] === "automations.save")).toBe(false);
  closeAutomationProposal();
  expect(automationProposalSnapshot()).toBeNull();
  expect(window.localStorage.length).toBe(0);
});
it("binds every owner RPC to the original environment and preserves edited session state", async () => {
  const session = await open();
  const captured = automationProposalSnapshot();
  session.cwd = "/different";
  session.model = "changed";
  expect(captured?.session.cwd).toBe("/repo");
  expect(captured?.session.model).not.toBe("changed");
  for (const call of mocks.request.mock.calls) expect(call[5]).toBe(machine.environmentId);
});
it("persists the exact create-only receipt before sending, then recovers a lost acknowledgement on the same Host", async () => {
  await open();
  let persisted: Record<string, unknown> | undefined;
  const read = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args: Parameters<typeof read>) => {
    if (args[1] === "automations.save") {
      expect(window.localStorage.length).toBe(1);
      persisted = (args[2] as { automation: Record<string, unknown> }).automation;
      expect(persisted.expectedAbsent).toBe(true);
      throw new Error("Lost acknowledgement");
    }
    if (args[1] === "automations.list")
      return [
        {
          ...Object.fromEntries(
            Object.entries(persisted ?? {}).filter(([key]) => key !== "expectedAbsent"),
          ),
          maxRunMinutes: 0,
          maxRunsPerDay: 0,
          enabled: true,
          nextRunAt: 123456,
          createdAt: 1,
          updatedAt: 1,
        },
      ];
    return read(...args);
  });
  await saveAutomationProposal();
  expect(automationProposalSnapshot()?.status).toBe("failed");
  const originalId = automationProposalSnapshot()?.automationId;
  closeAutomationProposal();
  openAutomationProposal(newSession("codex", "/other"), "A newer request stays in its composer");
  expect(automationProposalSnapshot()?.automationId).toBe(originalId);
  expect(automationProposalSnapshot()?.session.cwd).toBe("/repo");
  await saveAutomationProposal();
  expect(automationProposalSnapshot()?.status).toBe("saved");
  expect(mocks.request.mock.calls.filter((call) => call[1] === "automations.save")).toHaveLength(1);
});
