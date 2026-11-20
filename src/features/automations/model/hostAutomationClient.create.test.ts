import { afterEach, expect, it, vi } from "vitest";
import * as connections from "../../connections/model/connections";
import { LOCAL_SYNC_MACHINE_NAME } from "../../connections/model/localSync";
import type { RemoteMachine } from "../../connections/model/protocol";
import { createAutomationTrigger, newAutomationDraft } from "./automations";
import { saveHostAutomation } from "./hostAutomationClient";
import * as machineSnapshot from "./machineSnapshot";
import { HOST_AUTOMATION_ROOM, type HostAutomation } from "./hostAutomations";

const local: RemoteMachine = {
  id: "machine-local",
  name: LOCAL_SYNC_MACHINE_NAME,
  endpoint: "http://127.0.0.1:3774",
  environmentId: "env-local",
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("reuses the draft's create identity when an uncertain Host create is retried", async () => {
  vi.spyOn(machineSnapshot, "machineCapabilities").mockResolvedValue([HOST_AUTOMATION_ROOM]);
  const remote = vi
    .spyOn(connections, "remoteRequest")
    .mockRejectedValueOnce(new Error("Host did not answer"))
    .mockImplementationOnce(
      async (_machineId, _method, params) =>
        ({
          id: (params as { automation: { id: string } }).automation.id,
          name: "Nightly",
          prompt: "Review",
          projectId: "",
          harness: "claude",
          model: "claude:test",
          modelSettings: {},
          runtimeMode: "auto",
          scheduleKind: "daily",
          minute: 0,
          time: "09:00",
          dayOfWeek: 1,
          maxRunMinutes: 0,
          maxRunsPerDay: 0,
          enabled: true,
          nextRunAt: 10,
          createdAt: 1,
          updatedAt: 2,
        }) as HostAutomation,
    );
  const draft = {
    ...newAutomationDraft("", "claude", "claude:test"),
    hostMachineId: local.id,
    hostCreateId: "create-1",
    runInBackground: true,
    name: "Nightly",
    prompt: "Review",
    triggers: [createAutomationTrigger("time", "daily")],
  };

  await expect(saveHostAutomation([local], draft)).rejects.toThrow("Host did not answer");
  await saveHostAutomation([local], draft);

  expect(
    remote.mock.calls.map(
      ([, , params]) => (params as { automation: { id: string } }).automation.id,
    ),
  ).toEqual(["create-1", "create-1"]);
});
